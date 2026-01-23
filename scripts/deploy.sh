#!/bin/bash
# ===========================================
# ESTRO AI - EC2 Deployment Script
# ===========================================
# Usage: ./scripts/deploy.sh [--ssl] [--domain yourdomain.com]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
SSL_ENABLED=false
DOMAIN=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --ssl)
            SSL_ENABLED=true
            shift
            ;;
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  ESTRO AI - EC2 Deployment${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo -e "${YELLOW}Note: Some commands may require sudo${NC}"
fi

# Check for required tools
echo -e "${YELLOW}Checking required tools...${NC}"

check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}$1 is not installed. Installing...${NC}"
        return 1
    else
        echo -e "${GREEN}✓ $1 found${NC}"
        return 0
    fi
}

# Check Docker
if ! check_command docker; then
    echo -e "${YELLOW}Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo -e "${GREEN}Docker installed. You may need to log out and back in.${NC}"
fi

# Check Docker Compose
if ! check_command docker-compose; then
    echo -e "${YELLOW}Installing Docker Compose...${NC}"
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Check Git
check_command git || sudo yum install -y git || sudo apt-get install -y git

echo ""
echo -e "${YELLOW}Checking environment configuration...${NC}"

# Check for .env file
if [ ! -f .env ]; then
    if [ -f env.example ]; then
        echo -e "${YELLOW}Creating .env from env.example...${NC}"
        cp env.example .env
        echo -e "${RED}Please edit .env file with your configuration!${NC}"
        echo -e "${RED}Required: OPENAI_API_KEY, JWT_SECRET, MONGO_PASSWORD${NC}"
        exit 1
    else
        echo -e "${RED}.env file not found! Please create one.${NC}"
        exit 1
    fi
fi

# Validate required environment variables
source .env
MISSING_VARS=""

if [ -z "$OPENAI_API_KEY" ] || [ "$OPENAI_API_KEY" = "sk-your-openai-api-key-here" ]; then
    MISSING_VARS="${MISSING_VARS}OPENAI_API_KEY "
fi

if [ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" = "your-super-secure-jwt-secret-change-this" ]; then
    MISSING_VARS="${MISSING_VARS}JWT_SECRET "
fi

if [ -z "$MONGO_PASSWORD" ] || [ "$MONGO_PASSWORD" = "your-secure-mongo-password" ]; then
    MISSING_VARS="${MISSING_VARS}MONGO_PASSWORD "
fi

if [ -n "$MISSING_VARS" ]; then
    echo -e "${RED}Missing or invalid environment variables: ${MISSING_VARS}${NC}"
    echo -e "${RED}Please edit .env file with your configuration!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Environment configuration valid${NC}"

# Create necessary directories
echo ""
echo -e "${YELLOW}Creating directories...${NC}"
sudo mkdir -p /var/workspaces
sudo chmod 777 /var/workspaces
echo -e "${GREEN}✓ Created /var/workspaces${NC}"

# Create SSL directory if needed
if [ "$SSL_ENABLED" = true ]; then
    sudo mkdir -p ./nginx/ssl
    echo -e "${GREEN}✓ Created ./nginx/ssl${NC}"
fi

# Build workspace image
echo ""
echo -e "${YELLOW}Building workspace base image...${NC}"
docker build -t estro-ai-workspace:latest ./workspace-images/base/
echo -e "${GREEN}✓ Workspace image built${NC}"

# Create Docker network if not exists
echo ""
echo -e "${YELLOW}Creating Docker network...${NC}"
docker network create workspace-network 2>/dev/null || echo "Network already exists"
echo -e "${GREEN}✓ Docker network ready${NC}"

# Update environment for production
echo ""
echo -e "${YELLOW}Configuring for production...${NC}"

# Get public IP if domain not specified
if [ -z "$DOMAIN" ]; then
    PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || curl -s ifconfig.me)
    DOMAIN=$PUBLIC_IP
    echo -e "${YELLOW}Using public IP: ${DOMAIN}${NC}"
fi

# Update .env with production URLs
sed -i "s|FRONTEND_URL=.*|FRONTEND_URL=http://${DOMAIN}|g" .env
sed -i "s|DOMAIN=.*|DOMAIN=${DOMAIN}|g" .env

# Export for docker-compose
export NEXT_PUBLIC_API_URL="http://${DOMAIN}/api"
export NEXT_PUBLIC_WS_URL="ws://${DOMAIN}"

echo -e "${GREEN}✓ Production URLs configured${NC}"

# Stop existing containers
echo ""
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker-compose -f docker-compose.prod.yml down 2>/dev/null || true
echo -e "${GREEN}✓ Existing containers stopped${NC}"

# Build and start services
echo ""
echo -e "${YELLOW}Building and starting services...${NC}"
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo -e "Application URL: ${GREEN}http://${DOMAIN}${NC}"
echo -e "API Endpoint: ${GREEN}http://${DOMAIN}/api${NC}"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo "  View logs:    docker-compose -f docker-compose.prod.yml logs -f"
echo "  Stop:         docker-compose -f docker-compose.prod.yml down"
echo "  Restart:      docker-compose -f docker-compose.prod.yml restart"
echo "  Status:       docker-compose -f docker-compose.prod.yml ps"
echo ""

# Wait for services to be healthy
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
sleep 10

# Check health
if curl -s http://localhost/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is healthy${NC}"
else
    echo -e "${YELLOW}Backend still starting... Check logs with: docker-compose -f docker-compose.prod.yml logs backend${NC}"
fi

if curl -s http://localhost > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend is healthy${NC}"
else
    echo -e "${YELLOW}Frontend still starting... Check logs with: docker-compose -f docker-compose.prod.yml logs frontend${NC}"
fi

echo ""
echo -e "${GREEN}Done! Your Estro AI instance is ready.${NC}"
