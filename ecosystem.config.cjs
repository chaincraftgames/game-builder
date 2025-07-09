module.exports = {
  apps: [
    {
      name: 'chaincraft-web-api',
      script: './dist/index.js',
      // cwd is relative to the ecosystem config file location
      // If not specified, PM2 uses the directory where ecosystem.config.js is located
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0'
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
        HOST: '0.0.0.0'
      },
      // Restart policy
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
      
      // Logging
      log_file: './logs/web-api.log',
      out_file: './logs/web-api-out.log',
      error_file: './logs/web-api-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Memory management
      max_memory_restart: '1G',
      
      // Health monitoring
      health_check_interval: 30000,
      
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      
      // Auto restart on file changes (development only)
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.log'],
      
      // Source maps for better error tracking
      source_map_support: true,
      
      // Merge logs from all instances
      merge_logs: true
    },
    {
      name: 'chaincraft-discord-bot',
      script: './dist/integrations/clients/discord/index.js',
      // cwd is relative to the ecosystem config file location
      // If not specified, PM2 uses the directory where ecosystem.config.js is located
      instances: 1,
      exec_mode: 'fork', // Discord bot should run in fork mode, not cluster
      env: {
        NODE_ENV: 'production'
      },
      env_development: {
        NODE_ENV: 'development'
      },
      
      // Restart policy
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s',
      
      // Logging
      log_file: './logs/discord-bot.log',
      out_file: './logs/discord-bot-out.log',
      error_file: './logs/discord-bot-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Memory management
      max_memory_restart: '512M',
      
      // Health monitoring
      health_check_interval: 30000,
      
      // Graceful shutdown
      kill_timeout: 5000,
      
      // Auto restart on file changes (development only)
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.log'],
      
      // Source maps for better error tracking
      source_map_support: true,
      
      // Merge logs from all instances
      merge_logs: true
    }
  ],
  
  // Deployment configuration
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-production-server.com',
      ref: 'origin/main',
      repo: 'your-repo-url',
      path: '/var/www/chaincraft',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'apt update && apt install git -y'
    },
    development: {
      user: 'deploy',
      host: 'your-dev-server.com',
      ref: 'origin/develop',
      repo: 'your-repo-url',
      path: '/var/www/chaincraft-dev',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env development',
      'pre-setup': 'apt update && apt install git -y'
    }
  }
};
