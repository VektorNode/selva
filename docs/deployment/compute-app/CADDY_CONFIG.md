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
        # Forward the original request headers
        header_up X-Forwarded-For {http.request.remote.host}
        header_up X-Forwarded-Proto {http.request.proto}
        header_up X-Forwarded-Host {http.request.host}

        # Preserve cookies with proper SameSite policy
        header_down Set-Cookie "(.*)" "$1; SameSite=Strict"
    }
}
```

## With HTTPS & Custom Domain

Once you have a proper domain, update the config:

```caddy
example.com {
    reverse_proxy localhost:3000 {
        header_up X-Forwarded-For {http.request.remote.host}
        header_up X-Forwarded-Proto {http.request.proto}
        header_up X-Forwarded-Host {http.request.host}
        header_down Set-Cookie "(.*)" "$1; SameSite=Strict"
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

### Cookies Not Being Set

**Problem:** Admin login fails, cookies not persisting

**Solution:** Make sure `X-Forwarded-Proto` header is being passed (see config above)

Your app checks `process.env.NODE_ENV === 'production'` to set the `secure` cookie flag. This flag requires HTTPS. Without the correct headers, the app doesn't know it's receiving an HTTPS request.

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
    # Path to serve static files (optional)
    # root * /var/www/selva

    # Reverse proxy configuration
    reverse_proxy localhost:3000 {
        # === CRITICAL FOR SESSION/COOKIES ===
        # These headers tell the app what the original request looked like
        header_up X-Forwarded-For {http.request.remote.host}
        header_up X-Forwarded-Proto {http.request.proto}
        header_up X-Forwarded-Host {http.request.host}

        # Ensure cookies include SameSite attribute
        header_down Set-Cookie "(.*)" "$1; SameSite=Strict"
    }
}
```

## Production Checklist

- ✅ Set `X-Forwarded-Proto` header
- ✅ Set `X-Forwarded-For` header
- ✅ Use HTTPS (Caddy auto-handles with a proper domain)
- ✅ Set `SameSite=Strict` on cookies
- ✅ Node.js app has `ADMIN_SECRET` configured
- ✅ PM2 ecosystem.config.js loads `.env` file
