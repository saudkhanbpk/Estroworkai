#!/bin/bash
# ===========================================
# ESTRO AI - Update Script
# ===========================================
# Usage: ./scripts/update.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  ESTRO AI - Updating Deployment${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "docker-compose.prod.yml" ]; then
    echo -e "${RED}Error: docker-compose.prod.yml not found!${NC}"
    echo "Please run this script from the project root directory."
    exit 1
fi

# Create backup of current .env
if [ -f ".env" ]; then
    cp .env .env.backup
    echo -e "${GREEN}✓ Backed up .env to .env.backup${NC}"
fi

# Pull latest changes
echo -e "${YELLOW}Pulling latest changes from git...${NC}"
git pull origin main || git pull origin master || echo "Git pull skipped"

# Restore .env if it was overwritten
if [ -f ".env.backup" ]; then
    if ! diff -q .env .env.backup > /dev/null 2>&1; then
        echo -e "${YELLOW}Restoring your .env configuration...${NC}"
        cp .env.backup .env
    fi
fi

# Rebuild workspace image if Dockerfile changed
echo -e "${YELLOW}Rebuilding workspace image...${NC}"
docker build -t estro-ai-workspace:latest ./workspace-images/base/

# Stop current services
echo -e "${YELLOW}Stopping current services...${NC}"
docker-compose -f docker-compose.prod.yml down

# Rebuild and restart services
echo -e "${YELLOW}Rebuilding and starting services...${NC}"
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to start
echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
sleep 15

# Check health
echo ""
echo -e "${YELLOW}Checking service health...${NC}"
if curl -s http://localhost/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Backend is healthy${NC}"
else
    echo -e "${YELLOW}! Backend still starting...${NC}"
fi

if curl -s http://localhost > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Frontend is healthy${NC}"
else
    echo -e "${YELLOW}! Frontend still starting...${NC}"
fi

echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  Update Complete!${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""
echo "View logs: make logs"
echo "Check status: make status"
