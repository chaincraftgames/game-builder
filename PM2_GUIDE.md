# PM2 Process Management Guide

This guide explains how to manage the ChainCraft GameBuilder services using PM2.

## Services Overview

The application runs as two separate PM2 processes:

1. **chaincraft-web-api** - Fastify REST API server
2. **chaincraft-discord-bot** - Discord bot client

## Quick Start

### Development
```bash
# Start both services in development mode
npm run pm2:start:dev

# Check status
npm run pm2:status

# View logs
npm run pm2:logs
```

### Production
```bash
# Start both services in production mode
npm run pm2:start:prod

# Check status
npm run pm2:status

# Monitor processes
npm run pm2:monit
```

## Available Commands

### Process Management
- `npm run pm2:start` - Start processes with default environment
- `npm run pm2:start:dev` - Start with development environment
- `npm run pm2:start:prod` - Start with production environment
- `npm run pm2:stop` - Stop all processes
- `npm run pm2:restart` - Restart all processes
- `npm run pm2:reload` - Reload all processes (zero-downtime)
- `npm run pm2:delete` - Delete all processes from PM2

### Monitoring
- `npm run pm2:status` - Show process status
- `npm run pm2:logs` - Show all logs
- `npm run pm2:logs:api` - Show only web API logs
- `npm run pm2:logs:bot` - Show only Discord bot logs
- `npm run pm2:monit` - Open PM2 monitoring dashboard

### Direct PM2 Commands
```bash
# Start specific process
pm2 start ecosystem.config.js --only chaincraft-web-api

# Restart specific process
pm2 restart chaincraft-discord-bot

# Show detailed info
pm2 show chaincraft-web-api

# Flush logs
pm2 flush

# Save current process list
pm2 save

# Resurrect saved process list
pm2 resurrect
```

## Configuration Details

### Web API Process
- **Name**: chaincraft-web-api
- **Mode**: cluster (can scale horizontally)
- **Instances**: 1 (configure based on CPU cores)
- **Memory limit**: 1GB
- **Port**: Configured via `PORT` environment variable

### Discord Bot Process
- **Name**: chaincraft-discord-bot
- **Mode**: fork (single instance only)
- **Instances**: 1 (Discord bots must be single instance)
- **Memory limit**: 512MB

## Environment Variables

### Required for Web API
- `CHAINCRAFT_WEB_API_PORT` - Server port (default: 3000)
- `CHAINCRAFT_WEB_API_HOST` - Server host (default: 0.0.0.0)
- `CHAINCRAFT_WEB_API_NODE_ENV` - Environment (development/production)

### Required for Discord Bot
- `CHAINCRAFT_DISCORD_BOT_TOKEN` - Production bot token
- `CHAINCRAFT_DEV_DISCORD_BOT_TOKEN` - Development bot token
- `CHAINCRAFT_DISCORD_NODE_ENV` - Environment (development/production)

## Log Management

### Log Files Location
- `./logs/web-api.log` - Combined web API logs
- `./logs/web-api-out.log` - Web API stdout
- `./logs/web-api-error.log` - Web API stderr
- `./logs/discord-bot.log` - Combined Discord bot logs
- `./logs/discord-bot-out.log` - Discord bot stdout
- `./logs/discord-bot-error.log` - Discord bot stderr

### Log Rotation Setup
```bash
# Install log rotation module
pm2 install pm2-logrotate

# Configure rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

## Production Deployment

### Initial Setup
```bash
# Install PM2 globally
npm install -g pm2

# Install dependencies and build
npm install
npm run build

# Start services
npm run pm2:start:prod

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
pm2 startup
```

### Updates
```bash
# Stop processes
npm run pm2:stop

# Pull latest code
git pull

# Install dependencies and build
npm install
npm run build

# Start processes
npm run pm2:start:prod
```

### Zero-Downtime Deployment
```bash
# Build first
npm run build

# Reload processes (zero-downtime)
npm run pm2:reload
```

## Troubleshooting

### Common Issues

1. **Port already in use**
   ```bash
   # Check what's using the port
   lsof -i :3000
   
   # Kill process if needed
   kill -9 <PID>
   ```

2. **Memory issues**
   ```bash
   # Check memory usage
   pm2 monit
   
   # Increase memory limit in ecosystem.config.js
   max_memory_restart: '2G'
   ```

3. **Process won't start**
   ```bash
   # Check logs for errors
   pm2 logs chaincraft-web-api --lines 100
   
   # Check process details
   pm2 show chaincraft-web-api
   ```

4. **Discord bot connection issues**
   ```bash
   # Check Discord bot logs
   pm2 logs chaincraft-discord-bot
   
   # Verify bot token is correct
   # Check Discord Developer Portal
   ```

### Health Checks

```bash
# Check if web API is responding
curl http://localhost:3000/health

# Check PM2 process status
pm2 status

# Check system resources
pm2 monit
```

## Scaling

### Web API Scaling
The web API runs in cluster mode and can be scaled:

```bash
# Scale to 4 instances
pm2 scale chaincraft-web-api 4

# Scale down to 2 instances
pm2 scale chaincraft-web-api 2
```

### Discord Bot Scaling
The Discord bot must remain as a single instance (fork mode) as Discord doesn't support multiple connections with the same token.

## Best Practices

1. **Always build before starting**: `npm run build`
2. **Use environment-specific commands**: `pm2:start:dev` vs `pm2:start:prod`
3. **Monitor logs regularly**: `npm run pm2:logs`
4. **Use reload for zero-downtime updates**: `npm run pm2:reload`
5. **Save PM2 configuration**: `pm2 save` after making changes
6. **Set up log rotation** to prevent disk space issues
7. **Monitor memory usage** and adjust limits as needed
8. **Test in development** before deploying to production
