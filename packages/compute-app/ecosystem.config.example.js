// PM2 ecosystem configuration for Selva Compute App with Caddy
//
// Usage:
// 1. Copy this file as ecosystem.config.js
// 2. Update paths and environment variables
// 3. Run: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'selva-compute-1',
      script: './build/index.js',
      cwd: '/path/to/selva/packages/compute-app',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: 3000,
        ORIGIN: 'https://your-domain.com',
        COMPUTE_SERVER_URL: 'http://your-compute-server:8080',
        GH_DEFINITIONS_PATH: './definitions',
        COMPUTE_API_KEY: 'your-api-key-here',
      },
      error_file: './logs/app1-error.log',
      out_file: './logs/app1-out.log',
      restart_delay: 4000,
      max_restarts: 10,
    },
    {
      name: 'selva-compute-2',
      script: './build/index.js',
      cwd: '/path/to/selva/packages/compute-app',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: 3001,
        ORIGIN: 'https://your-domain.com',
        COMPUTE_SERVER_URL: 'http://your-compute-server:8080',
        GH_DEFINITIONS_PATH: './definitions',
        COMPUTE_API_KEY: 'your-api-key-here',
      },
      error_file: './logs/app2-error.log',
      out_file: './logs/app2-out.log',
      restart_delay: 4000,
      max_restarts: 10,
    },
    {
      name: 'selva-compute-3',
      script: './build/index.js',
      cwd: '/path/to/selva/packages/compute-app',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: 3002,
        ORIGIN: 'https://your-domain.com',
        COMPUTE_SERVER_URL: 'http://your-compute-server:8080',
        GH_DEFINITIONS_PATH: './definitions',
        COMPUTE_API_KEY: 'your-api-key-here',
      },
      error_file: './logs/app3-error.log',
      out_file: './logs/app3-out.log',
      restart_delay: 4000,
      max_restarts: 10,
    },
  ],
};
