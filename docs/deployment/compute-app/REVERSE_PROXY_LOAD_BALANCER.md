# Reverse Proxy with Caddy + PM2

Using Caddy as a simple reverse proxy to forward traffic from port 80 to your Selva Compute App running on PM2.

---

## Quick Start: PM2 + Caddy

**Install PM2 and Caddy:**

```bash
# Install Caddy (Ubuntu/Debian - official method)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install caddy
```

**Create Caddyfile** in `/etc/caddy/Caddyfile`:

```bash
sudo nano /etc/caddy/Caddyfile
```

Add your configuration:

**Option A: Using an IP Address (HTTP only)**

```caddy
:80 {
	reverse_proxy localhost:3000 {
		header_up X-Forwarded-For {http.request.remote.host}
		header_up X-Forwarded-Proto {http.request.proto}
		header_up X-Forwarded-Host {http.request.host}
	}
}
```

**Option B: Using a Domain (Automatic HTTPS)**

```caddy
example.com {
	reverse_proxy localhost:3000 {
		header_up X-Forwarded-For {http.request.remote.host}
		header_up X-Forwarded-Proto {http.request.proto}
		header_up X-Forwarded-Host {http.request.host}
	}
}
```

> **Note:** HTTPS requires a domain. If you use a raw IP address, you will be limited to HTTP. Caddy automatically handles HTTPS certificates only when a valid domain name is used. The `X-Forwarded-*` headers are important for the app to correctly detect the original client IP and protocol.

**Use ecosystem.config.cjs** (note: `.cjs` for CommonJS in ES module projects):

Environment variables go in the `env` object:

```javascript
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: './build/index.js',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			watch: false,
			max_memory_restart: '1G',
			env: {
				PORT: 3000,
				// ORIGIN: Public URL where users access the app (no trailing slash)
				// Important: This must match the URL users see in their browser
				ORIGIN: 'http://your-server-ip', // or https://example.com
				COMPUTE_SERVER_URL: 'http://your-compute-server:5000',
				GH_DEFINITIONS_PATH: './definitions',
				COMPUTE_API_KEY: 'your-api-key',
				BODY_SIZE_LIMIT: 'Infinity',
				ADMIN_PASSWORD: 'your-secure-password',
				ADMIN_SECRET: 'your-32-plus-char-secret',
				NODE_ENV: 'production'
			}
		}
	]
};
```

**Build and start:**

```bash
# Build app (from project root)
cd ~/selva
pnpm install
pnpm run build:compute

# Navigate to compute-app
cd packages/compute-app

# Start with PM2
pm2 start ecosystem.config.cjs

# Start Caddy (simple approach - runs in foreground)
sudo caddy run --config /etc/caddy/Caddyfile
```

**Verify:**

```bash
# Check PM2 app is running
pm2 list

# Test the reverse proxy (look for "Via: 1.1 Caddy" header)
curl -v http://your-public-ip/api/health
```

---

**Firewall (Google Cloud):**

Create firewall rules to allow port 80 and 443:

```bash
# Allow HTTP/HTTPS traffic
# Name: allow-http-https
# Direction: Ingress
# Action: Allow
# Source: 0.0.0.0/0
# Protocol: tcp:80, tcp:443
# Target tags: http-server, https-server
```

Then add the `http-server` and `https-server` tags to your VM instance.

## Troubleshooting

### Double Slashes in Requests (`//admin`, `//favicon.svg`)

**Symptom:** You see `[404] GET //admin` in PM2 logs

**Cause:** Mismatch between Caddy routing and app's ORIGIN setting

**Fix:** Ensure your Caddyfile includes proper headers and your ORIGIN matches the public URL:

```caddy
:80 {
	reverse_proxy localhost:3000 {
		header_up X-Forwarded-For {http.request.remote.host}
		header_up X-Forwarded-Proto {http.request.proto}
		header_up X-Forwarded-Host {http.request.host}
	}
}
```

Then verify `ecosystem.config.cjs` has correct ORIGIN (**NO trailing slash**):
```javascript
ORIGIN: 'http://34.52.176.223', // ✅ Correct
ORIGIN: 'http://34.52.176.223/', // ❌ Wrong - trailing slash causes double slashes
```

> **Important:** The ORIGIN must NOT have a trailing slash. Even a single `/` at the end will cause all routes to be prefixed with an extra `/`, resulting in `//admin`, `//favicon.svg`, etc.

After fixing, reload both services:
```bash
sudo caddy reload --config /etc/caddy/Caddyfile
pm2 restart selva-compute
```

## Useful Commands

**Caddy:**

```bash
# Stop Caddy (if running in background)
sudo pkill -f "caddy run"

# View Caddy status
ps aux | grep caddy

# Reload config (apply changes without downtime)
sudo caddy reload --config /etc/caddy/Caddyfile
```
