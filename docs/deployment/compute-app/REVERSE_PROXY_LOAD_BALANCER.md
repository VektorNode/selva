# Reverse Proxy & Load Balancer with Caddy

Using Caddy for SSL/TLS termination, reverse proxying, and load balancing across multiple Selva Compute App instances.

**Example configuration files are provided:**
- [docker-compose.example.yml](./docker-compose.example.yml) - Docker Compose setup
- [Caddyfile.example](./Caddyfile.example) - Caddy configuration
- [ecosystem.config.example.js](./ecosystem.config.example.js) - PM2 configuration

Copy and customize these files for your deployment.

---

## Quick Start: Docker + Caddy

**Copy [docker-compose.example.yml](./docker-compose.example.yml) as `docker-compose.yml` and update environment variables:**

```yaml
version: '3.8'

services:
  caddy:
    image: caddy:latest
    container_name: caddy-reverse-proxy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - app-network
    restart: unless-stopped

  web-1:
    image: selva-compute-app:latest
    environment:
      - PORT=3000
      - ORIGIN=https://your-domain.com
    networks:
      - app-network
    restart: unless-stopped
    expose:
      - 3000

  web-2:
    image: selva-compute-app:latest
    environment:
      - PORT=3000
      - ORIGIN=https://your-domain.com
    networks:
      - app-network
    restart: unless-stopped
    expose:
      - 3000

volumes:
  caddy_data:
  caddy_config:

networks:
  app-network:
    driver: bridge
```

**Copy [Caddyfile.example](./Caddyfile.example) as `Caddyfile` and update your domain:**

```caddy
your-domain.com {
    reverse_proxy web-1:3000 web-2:3000 {
        policy random
    }
}
```

**Start:**

```bash
docker-compose up -d
```

Caddy automatically handles SSL/TLS with Let's Encrypt.

---

## Quick Start: PM2 + Caddy

**Install PM2:**

```bash
sudo npm install -g pm2
```

**Copy [ecosystem.config.example.js](./ecosystem.config.example.js) as `ecosystem.config.js` and update paths/environment variables:**

```javascript
module.exports = {
  apps: [
    {
      name: 'selva-1',
      script: './build/index.js',
      cwd: '/path/to/selva/packages/compute-app',
      env: {
        PORT: 3000,
        ORIGIN: 'https://your-domain.com',
        COMPUTE_SERVER_URL: 'http://your-compute-server:8080',
        GH_DEFINITIONS_PATH: './definitions',
      },
    },
    {
      name: 'selva-2',
      script: './build/index.js',
      cwd: '/path/to/selva/packages/compute-app',
      env: {
        PORT: 3001,
        ORIGIN: 'https://your-domain.com',
        COMPUTE_SERVER_URL: 'http://your-compute-server:8080',
        GH_DEFINITIONS_PATH: './definitions',
      },
    },
  ],
};
```

**Caddyfile:**

```caddy
your-domain.com {
    reverse_proxy localhost:3000 localhost:3001 {
        policy random
    }
}
```

**Start:**

```bash
# Build first
cd /path/to/selva
pnpm run build:compute

# Start PM2
pm2 start ecosystem.config.js

# Install and start Caddy
sudo apt-get update
curl -1sLf 'https://dl.caddy.community/api/v1/repos/caddy/caddy/releases/download?os=linux&arch=amd64' | sudo bash
sudo apt-get install caddy
sudo systemctl start caddy
sudo systemctl enable caddy

# Monitor
pm2 monit
```

---

## Load Balancing Policies

In Caddyfile, use:

- `random` - Random selection (recommended)
- `least_conn` - Least connections
- `round_robin` - Sequential (default)

---

## Important Settings

**ORIGIN Environment Variable:**

Must match your public domain:

```bash
ORIGIN=https://your-domain.com
```

Restart containers/PM2 after changing:

```bash
# Docker
docker-compose restart

# PM2
pm2 restart all
```

**Firewall:**

Allow ports 80 and 443 (NOT port 3000):

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

---

## Monitoring

**Docker:**

```bash
docker-compose logs caddy -f
docker-compose ps
```

**PM2:**

```bash
pm2 list
pm2 logs
pm2 monit
```

---

## Useful Commands

**Docker - Update containers:**

```bash
docker-compose down
docker-compose build
docker-compose up -d
```

**PM2 - Restart apps:**

```bash
pm2 restart all
pm2 save
```

**Caddy - View certificates:**

Caddy automatically renews Let's Encrypt certificates. No action needed.

---

## Troubleshooting

**Connection refused:**

```bash
# Check apps are running
docker-compose ps    # Docker
pm2 list             # PM2
```

**Certificate not issuing:**

```bash
# Check domain DNS
nslookup your-domain.com

# Check Caddy logs
docker logs caddy-reverse-proxy    # Docker
sudo journalctl -u caddy -f        # PM2 setup
```

**CSRF errors:**

1. Verify `ORIGIN` matches your domain
2. Restart containers: `docker-compose restart` or `pm2 restart all`
3. Clear browser cache

---

## Next Steps

- [Docker Deployment Guide](./DOCKER_DEPLOYMENT.md)
- [Node Deployment Guide](./NODE_DEPLOYMENT.md)
- [Caddy Docs](https://caddyserver.com/docs/)
