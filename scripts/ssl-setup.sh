#!/bin/bash
# ===========================================
# ESTRO AI - SSL Certificate Setup Script
# ===========================================
# Usage: ./scripts/ssl-setup.sh [domain]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

DOMAIN=$1

if [ -z "$DOMAIN" ]; then
    echo -e "${YELLOW}Enter your domain name (e.g., estro-ai.yourdomain.com):${NC}"
    read DOMAIN
fi

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Domain is required!${NC}"
    exit 1
fi

echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}  SSL Setup for: ${DOMAIN}${NC}"
echo -e "${GREEN}=========================================${NC}"
echo ""

# Create SSL directory
mkdir -p ./nginx/ssl

# Check if certbot is available via Docker
echo -e "${YELLOW}Setting up SSL with Let's Encrypt...${NC}"
echo ""

# Stop nginx temporarily if running
docker stop estro-nginx 2>/dev/null || true

# Run certbot
echo -e "${YELLOW}Running Certbot (this may take a moment)...${NC}"
docker run -it --rm \
    -p 80:80 \
    -v "$(pwd)/nginx/ssl:/etc/letsencrypt" \
    certbot/certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email admin@${DOMAIN} \
    -d ${DOMAIN}

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ SSL certificates generated!${NC}"
    
    # Create symlinks for nginx
    echo -e "${YELLOW}Creating certificate symlinks...${NC}"
    ln -sf /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ./nginx/ssl/cert.pem 2>/dev/null || \
        cp ./nginx/ssl/live/${DOMAIN}/fullchain.pem ./nginx/ssl/cert.pem
    ln -sf /etc/letsencrypt/live/${DOMAIN}/privkey.pem ./nginx/ssl/key.pem 2>/dev/null || \
        cp ./nginx/ssl/live/${DOMAIN}/privkey.pem ./nginx/ssl/key.pem
    
    echo ""
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}  SSL Setup Complete!${NC}"
    echo -e "${GREEN}=========================================${NC}"
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo "1. Edit nginx/nginx.prod.conf:"
    echo "   - Uncomment SSL configuration lines"
    echo "   - Uncomment HTTPS redirect server block"
    echo ""
    echo "2. Restart services:"
    echo "   docker-compose -f docker-compose.prod.yml restart nginx"
    echo ""
    echo -e "${YELLOW}Certificate renewal:${NC}"
    echo "Certificates will auto-renew. To manually renew:"
    echo "docker run --rm -v \"\$(pwd)/nginx/ssl:/etc/letsencrypt\" certbot/certbot renew"
else
    echo -e "${RED}SSL setup failed!${NC}"
    echo "Make sure:"
    echo "1. Port 80 is accessible from the internet"
    echo "2. DNS for ${DOMAIN} points to this server"
    echo "3. No other service is using port 80"
    exit 1
fi
