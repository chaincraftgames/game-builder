# Logs directory
This directory contains PM2 process logs.

## Log Files:
- `web-api.log` - Combined web API logs
- `web-api-out.log` - Web API stdout
- `web-api-error.log` - Web API stderr
- `discord-bot.log` - Combined Discord bot logs
- `discord-bot-out.log` - Discord bot stdout
- `discord-bot-error.log` - Discord bot stderr

## Log Rotation:
Consider setting up log rotation to prevent disk space issues:
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```
