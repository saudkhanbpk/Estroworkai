#!/bin/bash
# ===========================================
# ESTRO AI - EC2 Initial Setup Script
# ===========================================
# Run this script once on a fresh EC2 instance
# Usage: curl -fsSL https://raw.githubusercontent.com/yourusername/estro-ai/main/scripts/setup-ec2.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  ESTRO AI - EC2 Setup Script${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
else
    OS=$(uname -s)
fi

echo -e "${YELLOW}Detected OS: ${OS}${NC}"
echo ""

# Update system
echo -e "${YELLOW}Updating system packages...${NC}"
if [[ "$OS" == *"Amazon"* ]] || [[ "$OS" == *"CentOS"* ]] || [[ "$OS" == *"Red Hat"* ]]; then
    sudo yum update -y
    INSTALL_CMD="sudo yum install -y"
elif [[ "$OS" == *"Ubuntu"* ]] || [[ "$OS" == *"Debian"* ]]; then
    sudo apt-get update
    sudo apt-get upgrade -y
    INSTALL_CMD="sudo apt-get install -y"
else
    echo -e "${RED}Unsupported OS. Please install dependencies manually.${NC}"
    INSTALL_CMD="sudo apt-get install -y"
fi

# Install Docker
echo ""
echo -e "${YELLOW}Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    rm get-docker.sh
    
    # Add current user to docker group
    sudo usermod -aG docker $USER
    
    # Start Docker service
    sudo systemctl start docker
    sudo systemctl enable docker
    
    echo -e "${GREEN}✓ Docker installed${NC}"
else
    echo -e "${GREEN}✓ Docker already installed${NC}"
fi

# Install Docker Compose
echo ""
echo -e "${YELLOW}Installing Docker Compose...${NC}"
if ! command -v docker-compose &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}✓ Docker Compose installed${NC}"
else
    echo -e "${GREEN}✓ Docker Compose already installed${NC}"
fi

# Install Git
echo ""
echo -e "${YELLOW}Installing Git...${NC}"
if ! command -v git &> /dev/null; then
    $INSTALL_CMD git
    echo -e "${GREEN}✓ Git installed${NC}"
else
    echo -e "${GREEN}✓ Git already installed${NC}"
fi

# Install useful tools
echo ""
echo -e "${YELLOW}Installing utilities...${NC}"
$INSTALL_CMD curl wget htop vim nano 2>/dev/null || true

# Create workspace directory
echo ""
echo -e "${YELLOW}Creating workspace directory...${NC}"
sudo mkdir -p /var/workspaces
sudo chmod 777 /var/workspaces
echo -e "${GREEN}✓ Created /var/workspaces${NC}"

# Create Docker network
echo ""
echo -e "${YELLOW}Creating Docker network...${NC}"
sudo docker network create workspace-network 2>/dev/null || echo "Network already exists"
echo -e "${GREEN}✓ Docker network ready${NC}"

# Configure swap (for smaller instances)
echo ""
echo -e "${YELLOW}Configuring swap space...${NC}"
if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo -e "${GREEN}✓ 2GB swap space configured${NC}"
else
    echo -e "${GREEN}✓ Swap already configured${NC}"
fi

# Set up firewall rules (if ufw is available)
if command -v ufw &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Configuring firewall...${NC}"
    sudo ufw allow 22/tcp
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw --force enable
    echo -e "${GREEN}✓ Firewall configured${NC}"
fi

# Print completion message
echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  EC2 Setup Complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo -e "Next steps:"
echo -e "1. ${YELLOW}Clone your repository:${NC}"
echo -e "   git clone https://github.com/yourusername/estro-ai.git"
echo -e "   cd estro-ai"
echo ""
echo -e "2. ${YELLOW}Configure environment:${NC}"
echo -e "   cp env.example .env"
echo -e "   nano .env"
echo ""
echo -e "3. ${YELLOW}Deploy:${NC}"
echo -e "   make deploy"
echo ""
echo -e "${RED}IMPORTANT: You may need to log out and back in for Docker permissions.${NC}"
echo -e "${RED}Or run: newgrp docker${NC}"
echo ""
