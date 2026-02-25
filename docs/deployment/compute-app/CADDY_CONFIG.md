# Caddy Configuration for Selva Compute App

Caddy is a reverse proxy that handles HTTPS and forwards requests to your Node.js application running on `localhost:3000`.

## Basic Setup

### 1. Install Caddy

```bash
sudo apt-get update
sudo apt-get install -y caddy
```

### 2. Configure Caddyfile

Edit `/etc/caddy/Caddyfile`:

```bash
sudo nano /etc/caddy/Caddyfile
```

### 3. Recommended Configuration

Replace the entire contents with:

```caddy
# Selva Compute App - Caddy Configuration
# Serves on HTTP (auto-HTTPS upgrade with proper domain)
# Proxies to localhost:3000

:80 {
    # Reverse proxy to the Node.js app
    reverse_proxy localhost:3000 {
        # Forward the protocol so the app knows to set secure cookie flag correctly
        header_up X-Forwarded-Proto "http"
    }
}
```

## With HTTPS & Custom Domain

Once you have a proper domain, update the config:

```caddy
example.com {
    reverse_proxy localhost:3000 {
        header_up X-Forwarded-Proto "https"
    }
}
```

Caddy will **automatically** obtain and renew an SSL certificate via Let's Encrypt.

## Reload Configuration

After editing, reload Caddy:

```bash
sudo systemctl reload caddy
```

Or restart it:

```bash
sudo systemctl restart caddy
```

## Check Status

```bash
sudo systemctl status caddy
```

## View Logs

```bash
sudo journalctl -u caddy -f
```

## Important Headers Explained

| Header | Purpose |
|--------|---------|
| `X-Forwarded-For` | Original client IP address |
| `X-Forwarded-Proto` | Original protocol (http/https) - **critical for secure cookies** |
| `X-Forwarded-Host` | Original host header |
| `Set-Cookie` | Ensures SameSite policy is enforced |

## Troubleshooting

### Cookies Not Being Set / Admin Login Fails

**Problem:** You can log in, but the session cookie isn't saved and you're redirected back to login.

**Root Cause:** The app sets the `Secure` flag on cookies in production mode, which requires HTTPS. If you're using HTTP, the browser won't save the cookie.

**Solutions:**

1. **For HTTPS (recommended):**
   - Use a proper domain with Caddy's auto-HTTPS
   - Caddy handles SSL certificates automatically
   - Cookies will have the correct `Secure` flag

2. **For HTTP deployments (development only):**
   - Set `ALLOW_INSECURE_COOKIES=true` in ecosystem.config.cjs:
     ```javascript
     env: {
       ALLOW_INSECURE_COOKIES: 'true'
     }
     ```
   - This tells the app to create non-secure cookies on HTTP
   - Remember to restart PM2: `pm2 restart selva-compute --update-env`

3. **Ensure `X-Forwarded-Proto` header is correct:**
   - For HTTP: `header_up X-Forwarded-Proto "http"`
   - For HTTPS: `header_up X-Forwarded-Proto "https"`

### Connection Refused

**Problem:** `reverse_proxy localhost:3000` fails

**Solution:** Verify the Node.js app is running:

```bash
pm2 status
```

Should show `selva-compute` as `online` on port 3000.

### Port Already in Use

**Problem:** Caddy won't start (port 80/443 in use)

**Solution:** Check what's using the ports:

```bash
sudo lsof -i :80
sudo lsof -i :443
```

## Full Example with Comments

```caddy
# Your domain or IP address
:80 {
    # Reverse proxy configuration
    reverse_proxy localhost:3000 {
        # CRITICAL: Tell the app the original protocol
        # This is required for secure cookie handling
        header_up X-Forwarded-Proto "http"
    }
}
```

**For HTTPS:**

```caddy
example.com {
    reverse_proxy localhost:3000 {
        header_up X-Forwarded-Proto "https"
    }
}
```

## Production Checklist

- ✅ Set `X-Forwarded-Proto` header (either "http" or "https")
- ✅ Use absolute paths for `GH_DEFINITIONS_PATH` in ecosystem.config.cjs
- ✅ Set `ADMIN_PASSWORD` in ecosystem.config.cjs
- ✅ For HTTPS: Use a proper domain and let Caddy handle SSL
- ✅ For HTTP (dev only): Set `ALLOW_INSECURE_COOKIES=true` in ecosystem.config.cjs
- ✅ Restart PM2 with `--update-env` after changing environment variables: `pm2 restart selva-compute --update-env`
