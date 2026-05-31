# Production Deployment Guide

This guide covers deploying the ChainCraft GameBuilder to AWS LightSail or similar production environments.

## Prerequisites

- Node.js 18+ installed
- PM2 installed globally: `npm install -g pm2`
- Git configured with access to the repository
- Environment variables configured (`.env` file)

## Initial Deployment

### 1. Clone and Setup
```bash
# Clone the repository
git clone https://github.com/chaincraftgames/game-builder.git
cd game-builder

# Install dependencies
npm install

# Create .env file with your production secrets
cp .env.example .env
nano .env  # Edit with your production values
```

### 2. Build the Application
```bash
# Build TypeScript to JavaScript
npm run build
```

### 3. Start Services with PM2
```bash
# Start both web API and Discord bot in production mode
npm run pm2:start:prod

# Check that services are running
pm2 status
```

### 4. Configure Auto-Start on Boot
```bash
# Save current PM2 configuration
pm2 save

# Generate startup script for your system
pm2 startup

# Follow the command PM2 provides (example):
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u ubuntu --hp /home/ubuntu

# Verify the startup configuration
sudo systemctl status pm2-ubuntu  # Replace 'ubuntu' with your username
```

### 5. Verify Deployment
```bash
# Check PM2 status
pm2 status

# Test the web API
curl http://localhost:3000/health

# Check logs for any issues
pm2 logs --lines 20
```

## Updates and Redeployments

### Standard Update Process
```bash
# 1. Pull latest changes
git pull origin game-builder-web-api

# 2. Stop services gracefully
npm run pm2:stop

# 3. Install any new dependencies
npm install

# 4. Rebuild the application
npm run build

# 5. Start services again
npm run pm2:start:prod

# 6. Save the updated configuration
pm2 save

# 7. Verify services are running
pm2 status
```

### Zero-Downtime Updates (Recommended)
```bash
# 1. Pull and build first
git pull origin game-builder-web-api
npm install
npm run build

# 2. Reload services without downtime
npm run pm2:reload

# 3. Save configuration
pm2 save
```

## CI/CD Secret Injection

Integration tests that require live API keys (e.g., `npm run test:simulation`) must **never** use secrets stored in committed files. All CI/CD pipelines should inject secrets via the platform's secrets management — not via a `.env` file checked into the repository.

### GitHub Actions

Store `ANTHROPIC_API_KEY` (and any other required keys) as [encrypted repository secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets):

1. Go to **Settings → Secrets and variables → Actions → New repository secret**.
2. Name it `ANTHROPIC_API_KEY` and paste the key value.

Reference the secret in your workflow file:

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Run simulation tests
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          LATEST_SONNET_MODEL: claude-sonnet-4-6
          LATEST_HAIKU_MODEL: claude-haiku-4-5-20251001
        run: npm run test:simulation
```

> **Note**: Never write `ANTHROPIC_API_KEY=...` directly in the workflow file. Always use `${{ secrets.SECRET_NAME }}`.

### GitLab CI

Store the key as a [masked CI/CD variable](https://docs.gitlab.com/ee/ci/variables/) (**Settings → CI/CD → Variables → Add variable**, tick *Mask variable*):

```yaml
integration_tests:
  stage: test
  script:
    - npm ci
    - npm run build
    - npm run test:simulation
  variables:
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY   # Injected from CI/CD settings
    LATEST_SONNET_MODEL: "claude-sonnet-4-6"
    LATEST_HAIKU_MODEL: "claude-haiku-4-5-20251001"
```

### Verifying No Committed Secrets

After setting up CI/CD, confirm that no real keys exist in the repository:

```bash
# Search entire git history for Anthropic key patterns
git log --all -p | grep -E 'sk-ant-'

# Check all tracked files
git grep -E 'sk-ant-'
```

---

## Environment Configuration

### Required Environment Variables
Create a `.env` file with these production values:

```bash
# Node Environment
NODE_ENV=production

# Web API Configuration
CHAINCRAFT_WEB_API_PORT=3000
CHAINCRAFT_WEB_API_HOST=0.0.0.0
CHAINCRAFT_GAMEBUILDER_API_KEY=your-secure-api-key

# Discord Bot
CHAINCRAFT_DISCORD_BOT_TOKEN=your-production-bot-token
CHAINCRAFT_GUILD_ID=your-guild-id
CHAINCRAFT_DESIGN_CHANNEL_ID=your-design-channel-id
CHAINCRAFT_SIMULATION_CHANNEL_ID=your-simulation-channel-id

# AI Models
CHAINCRAFT_GAME_DESIGN_MODEL_NAME=your-model-name
CHAINCRAFT_SIMULATION_MODEL_NAME=your-simulation-model

# API Keys
CHAINCRAFT_GAMEBUILDER_DALLE_IMAGEGEN_API_KEY=your-openai-key
CHAINCRAFT_GAMEBUILDER_LEO_IMAGEGEN_API_KEY=your-leonardo-key

# Checkpoint Database Configuration
# Default: sqlite (uses data/ directory)
# For ephemeral filesystem deployments (Railway, etc.), use postgres
CHECKPOINT_DB_TYPE=sqlite
# POSTGRES_CONNECTION_STRING=postgresql://user:password@host:port/database

# Other configurations...
```

### Security Best Practices
- Set restrictive file permissions: `chmod 600 .env`
- Never commit the `.env` file to git
- Use strong, unique API keys for production
- Regularly rotate secrets

## Monitoring and Maintenance

### Checking Service Health
```bash
# PM2 status dashboard
pm2 status

# Real-time monitoring
pm2 monit

# Check logs
pm2 logs
pm2 logs chaincraft-web-api
pm2 logs chaincraft-discord-bot

# Check recent logs only
pm2 logs --lines 50
```

### Log Management
```bash
# Flush all logs
pm2 flush

# Install log rotation (recommended)
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

### Performance Monitoring
```bash
# Show process information
pm2 show chaincraft-web-api
pm2 show chaincraft-discord-bot

# Memory and CPU usage
pm2 monit

# Restart if memory usage is high
pm2 restart chaincraft-web-api
```

## Troubleshooting

### Services Won't Start
```bash
# Check for build errors
npm run build

# Check PM2 logs for errors
pm2 logs --err

# Manually test the application
node ./dist/index.js
```

### API Not Responding
```bash
# Check if port is in use
netstat -tulpn | grep :3000

# Check firewall settings
sudo ufw status

# Check service logs
pm2 logs chaincraft-web-api
```

### Discord Bot Not Connecting
```bash
# Check bot logs
pm2 logs chaincraft-discord-bot

# Verify environment variables
pm2 show chaincraft-discord-bot

# Test bot token (without logging it!)
# Check Discord Developer Portal for bot status
```

### Memory Issues
```bash
# Check memory usage
free -h
pm2 monit

# Restart high-memory processes
pm2 restart chaincraft-web-api

# Adjust memory limits in ecosystem.config.cjs if needed
```

## Backup and Recovery

### Configuration Backup
```bash
# Backup PM2 configuration
pm2 save
cp ~/.pm2/dump.pm2 ~/pm2-backup-$(date +%Y%m%d).pm2

# Backup environment file
cp .env .env.backup-$(date +%Y%m%d)
```

### Disaster Recovery
```bash
# Restore PM2 configuration
pm2 resurrect

# If that fails, restore from backup
cp ~/pm2-backup-YYYYMMDD.pm2 ~/.pm2/dump.pm2
pm2 resurrect

# Or restart from ecosystem config
npm run pm2:start:prod
```

## Load Balancer/Reverse Proxy Setup

### Nginx Configuration (Optional)
If using a reverse proxy, create `/etc/nginx/sites-available/chaincraft`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Security Checklist

- [ ] Environment variables are secure and not logged
- [ ] `.env` file has restricted permissions (600)
- [ ] Firewall is configured (only necessary ports open)
- [ ] Regular security updates applied
- [ ] Log rotation configured
- [ ] PM2 auto-restart configured
- [ ] API keys are production-specific
- [ ] Discord bot token is for production bot

## Quick Commands Reference

```bash
# Start services
npm run pm2:start:prod

# Stop services
npm run pm2:stop

# Restart services
npm run pm2:restart

# Reload (zero-downtime)
npm run pm2:reload

# Check status
npm run pm2:status

# View logs
npm run pm2:logs

# Save configuration
pm2 save

# Monitoring dashboard
pm2 monit
```

## Checkpoint Database Configuration

The application supports both SQLite (default) and PostgreSQL for checkpoint storage:

- **SQLite** (`CHECKPOINT_DB_TYPE=sqlite`): Stores checkpoints in `data/` directory. Suitable for persistent filesystems.
- **PostgreSQL** (`CHECKPOINT_DB_TYPE=postgres`): Required for ephemeral filesystem deployments (Railway, Docker containers, etc.). Set `POSTGRES_CONNECTION_STRING` to your database connection string.

Tables are created automatically on first run. Data is not automatically migrated between backends.

Remember: Always test deployments in a staging environment first!
