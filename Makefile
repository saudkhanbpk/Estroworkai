# ===========================================
# ESTRO AI - Makefile
# ===========================================
# Usage: make <target>

.PHONY: help install dev build start stop restart logs clean deploy setup-ec2 workspace-image

# Default target
help:
	@echo ""
	@echo "Estro AI - Available Commands"
	@echo "=============================="
	@echo ""
	@echo "Development:"
	@echo "  make install        - Install all dependencies"
	@echo "  make dev            - Start development environment"
	@echo "  make dev-backend    - Start backend only (dev mode)"
	@echo "  make dev-frontend   - Start frontend only (dev mode)"
	@echo ""
	@echo "Production:"
	@echo "  make build          - Build production images"
	@echo "  make start          - Start production services"
	@echo "  make stop           - Stop all services"
	@echo "  make restart        - Restart all services"
	@echo "  make logs           - View service logs"
	@echo ""
	@echo "EC2 Deployment:"
	@echo "  make setup-ec2      - Initial EC2 setup (run once)"
	@echo "  make deploy         - Deploy to production"
	@echo ""
	@echo "Utilities:"
	@echo "  make workspace-image - Build workspace base image"
	@echo "  make clean          - Remove all containers and volumes"
	@echo "  make status         - Show container status"
	@echo "  make shell-backend  - Open shell in backend container"
	@echo "  make shell-frontend - Open shell in frontend container"
	@echo ""

# ===========================================
# Development Commands
# ===========================================

install:
	@echo "Installing backend dependencies..."
	cd backend && npm install
	@echo "Installing frontend dependencies..."
	cd frontend && npm install
	@echo "Done!"

dev:
	@echo "Starting development environment..."
	docker-compose up -d mongodb redis
	@echo "Waiting for MongoDB to be ready..."
	sleep 5
	@echo "Building workspace image..."
	make workspace-image
	@echo "Starting backend and frontend..."
	cd backend && npm run dev &
	cd frontend && npm run dev

dev-backend:
	cd backend && npm run dev

dev-frontend:
	cd frontend && npm run dev

# ===========================================
# Production Commands
# ===========================================

build:
	@echo "Building production images..."
	docker-compose -f docker-compose.prod.yml build

start:
	@echo "Starting production services..."
	docker-compose -f docker-compose.prod.yml up -d
	@echo "Services started. View logs with: make logs"

stop:
	@echo "Stopping services..."
	docker-compose -f docker-compose.prod.yml down

restart:
	@echo "Restarting services..."
	docker-compose -f docker-compose.prod.yml restart

logs:
	docker-compose -f docker-compose.prod.yml logs -f

logs-backend:
	docker-compose -f docker-compose.prod.yml logs -f backend

logs-frontend:
	docker-compose -f docker-compose.prod.yml logs -f frontend

# ===========================================
# EC2 Deployment Commands
# ===========================================

setup-ec2:
	@echo "Setting up EC2 instance..."
	@echo "Installing Docker..."
	@which docker > /dev/null 2>&1 || (curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh && rm get-docker.sh)
	@echo "Installing Docker Compose..."
	@which docker-compose > /dev/null 2>&1 || (sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$$(uname -s)-$$(uname -m)" -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose)
	@echo "Creating directories..."
	sudo mkdir -p /var/workspaces
	sudo chmod 777 /var/workspaces
	@echo "Creating workspace network..."
	docker network create workspace-network 2>/dev/null || true
	@echo "Building workspace image..."
	make workspace-image
	@echo ""
	@echo "EC2 setup complete!"
	@echo "Next steps:"
	@echo "1. Copy env.example to .env and configure"
	@echo "2. Run 'make deploy'"

deploy:
	@echo "Deploying to production..."
	chmod +x scripts/deploy.sh
	./scripts/deploy.sh

# ===========================================
# Utility Commands
# ===========================================

workspace-image:
	@echo "Building workspace base image..."
	docker build -t estro-ai-workspace:latest ./workspace-images/base/

clean:
	@echo "Stopping all containers..."
	docker-compose -f docker-compose.prod.yml down -v 2>/dev/null || true
	docker-compose down -v 2>/dev/null || true
	@echo "Removing workspace containers..."
	docker ps -a --filter "name=workspace-" -q | xargs -r docker rm -f
	@echo "Removing workspace image..."
	docker rmi estro-ai-workspace:latest 2>/dev/null || true
	@echo "Clean complete!"

clean-workspaces:
	@echo "Removing all workspace containers..."
	docker ps -a --filter "name=workspace-" -q | xargs -r docker rm -f
	@echo "Cleaning workspace files..."
	sudo rm -rf /var/workspaces/*
	@echo "Done!"

status:
	@echo "Container Status:"
	@echo "================="
	docker-compose -f docker-compose.prod.yml ps 2>/dev/null || docker-compose ps
	@echo ""
	@echo "Workspace Containers:"
	@echo "===================="
	docker ps --filter "name=workspace-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

shell-backend:
	docker exec -it estro-backend sh

shell-frontend:
	docker exec -it estro-frontend sh

shell-mongodb:
	docker exec -it estro-mongodb mongosh -u admin -p

# ===========================================
# Health Checks
# ===========================================

health:
	@echo "Checking service health..."
	@echo ""
	@echo "Backend API:"
	@curl -s http://localhost:5000/api/health 2>/dev/null || curl -s http://localhost/api/health 2>/dev/null || echo "Not responding"
	@echo ""
	@echo ""
	@echo "Frontend:"
	@curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost:3000 2>/dev/null || curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost 2>/dev/null || echo "Not responding"

# ===========================================
# Database Commands
# ===========================================

db-backup:
	@echo "Creating MongoDB backup..."
	docker exec estro-mongodb mongodump --archive=/tmp/backup.gz --gzip -u admin -p --authenticationDatabase admin
	docker cp estro-mongodb:/tmp/backup.gz ./backup-$$(date +%Y%m%d-%H%M%S).gz
	@echo "Backup created!"

db-restore:
	@echo "Restoring MongoDB from backup..."
	@read -p "Enter backup filename: " filename; \
	docker cp $$filename estro-mongodb:/tmp/restore.gz; \
	docker exec estro-mongodb mongorestore --archive=/tmp/restore.gz --gzip -u admin -p --authenticationDatabase admin
	@echo "Restore complete!"

# ===========================================
# SSL Commands
# ===========================================

ssl-setup:
	@echo "Setting up SSL with Let's Encrypt..."
	@read -p "Enter your domain: " domain; \
	sudo mkdir -p ./nginx/ssl; \
	docker run -it --rm -p 80:80 -v ./nginx/ssl:/etc/letsencrypt certbot/certbot certonly --standalone -d $$domain
	@echo "SSL certificates generated!"
	@echo "Update nginx.prod.conf to enable SSL"
