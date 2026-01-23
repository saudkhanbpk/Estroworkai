# Estro AI - AI-Powered Web IDE Platform

An AI-powered web IDE platform that generates complete web applications from natural language prompts. Each user gets an isolated Docker container for safe code execution.

![Estro AI](https://img.shields.io/badge/AI-Powered-blue) ![Docker](https://img.shields.io/badge/Docker-Containerized-blue) ![Node.js](https://img.shields.io/badge/Node.js-20+-green)

## Features

- 🤖 **AI Code Generation** - Describe your project, AI creates it
- 📝 **Monaco Editor** - VS Code-like editing experience
- 🔄 **Live Preview** - See changes instantly
- 🐳 **Isolated Sandboxes** - Each workspace runs in Docker
- 💬 **AI Chat** - Iterative improvements via chat
- 📁 **File Explorer** - Browse and manage files
- 🖥️ **Integrated Terminal** - Run commands directly

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14, React, TypeScript, Tailwind CSS |
| Backend | Node.js, Express, Socket.io |
| AI Agent | LangChain, OpenAI GPT-4 |
| Database | MongoDB |
| Cache | Redis |
| Containers | Docker, Dockerode |
| Proxy | Nginx |

## Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- OpenAI API key

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/estro-ai.git
cd estro-ai

# 2. Configure environment
cp env.example .env
# Edit .env with your OpenAI API key

# 3. Build workspace image
docker build -t estro-ai-workspace:latest ./workspace-images/base/

# 4. Start development
make dev
# Or manually:
docker-compose up -d mongodb redis
cd backend && npm install && npm run dev &
cd frontend && npm install && npm run dev
```

Visit http://localhost:3000

---

## EC2 Deployment Guide

### 1. Launch EC2 Instance

**Recommended specs:**
- **Instance Type:** t3.medium or larger (2 vCPU, 4GB RAM minimum)
- **AMI:** Amazon Linux 2023 or Ubuntu 22.04
- **Storage:** 30GB+ SSD
- **Security Group:**
  - SSH (22) - Your IP
  - HTTP (80) - 0.0.0.0/0
  - HTTPS (443) - 0.0.0.0/0

### 2. Connect & Setup

```bash
# Connect to your EC2 instance
ssh -i your-key.pem ec2-user@your-ec2-ip

# Clone the repository
git clone https://github.com/yourusername/estro-ai.git
cd estro-ai

# Run EC2 setup (installs Docker, creates directories)
make setup-ec2
```

### 3. Configure Environment

```bash
# Copy and edit environment file
cp env.example .env
nano .env
```

**Required settings:**
```env
OPENAI_API_KEY=sk-your-actual-api-key
JWT_SECRET=generate-with-openssl-rand-hex-32
MONGO_PASSWORD=your-secure-password
```

Generate secure secrets:
```bash
# Generate JWT secret
openssl rand -hex 32

# Generate Mongo password
openssl rand -base64 24
```

### 4. Deploy

```bash
# Deploy to production
make deploy

# Or use the deploy script directly
./scripts/deploy.sh
```

### 5. Verify Deployment

```bash
# Check container status
make status

# Check health
make health

# View logs
make logs
```

Your app is now running at `http://your-ec2-ip`

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `make help` | Show all available commands |
| `make dev` | Start development environment |
| `make deploy` | Deploy to production |
| `make start` | Start production services |
| `make stop` | Stop all services |
| `make restart` | Restart services |
| `make logs` | View all logs |
| `make status` | Show container status |
| `make clean` | Remove all containers |

---

## Project Structure

```
estro-ai/
├── backend/                    # Node.js API server
│   ├── src/
│   │   ├── agents/            # LangChain AI agent
│   │   ├── controllers/       # REST API handlers
│   │   ├── models/            # MongoDB schemas
│   │   ├── routes/            # Express routes
│   │   ├── services/          # Business logic
│   │   ├── utils/             # Docker, logger utilities
│   │   └── websocket/         # WebSocket handlers
│   ├── Dockerfile
│   └── Dockerfile.prod
│
├── frontend/                   # Next.js web app
│   ├── components/            # React components
│   │   ├── Editor.tsx         # Monaco code editor
│   │   ├── FileTree.tsx       # File explorer
│   │   ├── Preview.tsx        # Live preview iframe
│   │   └── Terminal.tsx       # Terminal emulator
│   ├── pages/
│   │   ├── index.tsx          # Landing page
│   │   └── workspace/[id].tsx # IDE workspace
│   ├── services/              # API & WebSocket clients
│   ├── Dockerfile
│   └── Dockerfile.prod
│
├── nginx/                      # Nginx configuration
│   ├── nginx.conf             # Development config
│   └── nginx.prod.conf        # Production config
│
├── workspace-images/           # Docker workspace image
│   └── base/Dockerfile
│
├── scripts/
│   └── deploy.sh              # EC2 deployment script
│
├── docker-compose.yml          # Development compose
├── docker-compose.prod.yml     # Production compose
├── Makefile                    # Command shortcuts
└── env.example                 # Environment template
```

---

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login user |
| GET | `/api/auth/profile` | Get user profile |

### Workspace
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/workspace/create` | Create workspace |
| GET | `/api/workspace` | List user workspaces |
| GET | `/api/workspace/:id` | Get workspace details |
| POST | `/api/workspace/:id/run-prompt` | Run AI prompt |
| DELETE | `/api/workspace/:id` | Delete workspace |

### Files
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/file/:id/list` | List files |
| GET | `/api/file/:id/read` | Read file content |
| POST | `/api/file/:id/write` | Write file |
| DELETE | `/api/file/:id/delete` | Delete file |

### Terminal
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/terminal/:id/exec` | Execute command |
| POST | `/api/terminal/:id/start` | Start dev server |
| POST | `/api/terminal/:id/stop` | Stop dev server |

---

## WebSocket Events

### Client → Server
- `workspace:join` - Join workspace room
- `workspace:leave` - Leave workspace room
- `terminal:input` - Send terminal input

### Server → Client
- `agent:update` - AI agent progress
- `workspace:updated` - Files changed
- `terminal:output` - Terminal output
- `server:error` - Error notifications

---

## SSL/HTTPS Setup

### Using Let's Encrypt (Recommended)

```bash
# Generate SSL certificate
make ssl-setup

# Enter your domain when prompted
```

Then update `nginx/nginx.prod.conf`:
1. Uncomment SSL server block
2. Uncomment HTTPS redirect
3. Update certificate paths

Restart nginx:
```bash
docker-compose -f docker-compose.prod.yml restart nginx
```

### Using Custom Certificates

1. Place certificates in `nginx/ssl/`:
   - `cert.pem` - Certificate
   - `key.pem` - Private key

2. Update `nginx.prod.conf` with paths

3. Restart services

---

## Scaling & Performance

### Horizontal Scaling
- Use AWS ALB for load balancing
- Run multiple backend instances
- Use Redis for session sharing

### Workspace Limits
Configure in `.env`:
```env
CONTAINER_MEMORY_LIMIT=536870912  # 512MB per container
MAX_WORKSPACES_PER_USER=5
```

### Monitoring
- Health endpoint: `GET /api/health`
- Container metrics: `docker stats`
- Logs: `make logs`

---

## Troubleshooting

### Container won't start
```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs backend

# Check Docker socket permissions
ls -la /var/run/docker.sock
```

### Workspace preview not loading
```bash
# Check workspace container
docker ps --filter "name=workspace-"

# Check port mapping
docker port workspace-{id}
```

### MongoDB connection issues
```bash
# Test MongoDB connection
docker exec estro-mongodb mongosh -u admin -p
```

### AI not generating code
- Verify `OPENAI_API_KEY` in `.env`
- Check backend logs: `make logs-backend`
- Ensure API key has sufficient credits

---

## Security Considerations

- ✅ JWT authentication required
- ✅ Isolated Docker containers per workspace
- ✅ Resource limits (CPU, memory)
- ✅ Network isolation between containers
- ✅ Rate limiting via Nginx
- ✅ CORS protection

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Support

- 📧 Email: support@estro-ai.com
- 🐛 Issues: [GitHub Issues](https://github.com/yourusername/estro-ai/issues)
- 📖 Docs: [Documentation](https://docs.estro-ai.com)
