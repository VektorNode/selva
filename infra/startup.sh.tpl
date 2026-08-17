#!/bin/bash
set -e

# Log everything for debugging: sudo tail -f /var/log/selva-startup.log
exec > >(tee /var/log/selva-startup.log) 2>&1

echo "=== Selva startup script beginning ==="

echo ""
echo "================================================================"
echo "Point the A record for ${domain} at ${public_ip}"
echo "  (Caddy will retry ACME if it's not ready yet — not fatal.)"
echo "================================================================"
echo ""

INSTALL_DIR="/home/${ssh_user}/selva"

# ----------------------------------------------------------------------------
# 1. Install Node.js + npm (NodeSource — gives us Node 24 with corepack).
#    Must stay >= the `engines.node` floor in every package.json.
# ----------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "Node $(node -v), npm $(npm -v)"

mkdir -p "$INSTALL_DIR"
chown "${ssh_user}:${ssh_user}" "$INSTALL_DIR"

# ----------------------------------------------------------------------------
# 2. Scaffold + install + start, all as the ssh_user.
#
# Env vars feed @selvajs/cli's collectConfigFromEnv() — see
# packages/cli/src/prompts.js. The CLI throws if anything required is
# missing (e.g. SUPABASE_* when a supabase provider is selected), which
# surfaces in the startup log instead of producing a half-configured app.
# ----------------------------------------------------------------------------
sudo -u ${ssh_user} -H bash <<USER_EOF
set -e
cd "$INSTALL_DIR"

export SELVA_TENANCY="${tenancy}"
export SELVA_AUTH_PROVIDER="${auth_provider}"
export SELVA_DATA_PROVIDER="${data_provider}"
export SELVA_STORAGE_PROVIDER="${storage_provider}"
export DATA_PATH="./.selva-data"
export ORIGIN="https://${domain}"
export BOOTSTRAP_INSTANCE_ADMIN_EMAIL="${bootstrap_admin_email}"
export SUPABASE_URL="${supabase_url}"
export SUPABASE_ANON_KEY="${supabase_anon_key}"
export SUPABASE_SERVICE_ROLE_KEY="${supabase_service_role_key}"

# --force makes this idempotent — Terraform re-applies don't error if the
# directory already has a scaffold.
npx -y @selvajs/cli@latest . --yes --force

# `npm start` → `selva start` → `pm2 start ecosystem.config.cjs`. pm2 is in
# the scaffold's deps so node_modules/.bin/pm2 already exists by now.
npm start
./node_modules/.bin/pm2 save
USER_EOF

# pm2's "restart on boot" hook needs to be installed by root because it
# writes a systemd unit. Generate the exact command pm2 wants run, then run it.
STARTUP_CMD=$(
  sudo -u ${ssh_user} -H bash -c \
    "cd '$INSTALL_DIR' && ./node_modules/.bin/pm2 startup systemd -u ${ssh_user} --hp /home/${ssh_user} 2>&1" \
    | grep -E '^sudo env' || true
)
if [ -n "$STARTUP_CMD" ]; then
  eval "$STARTUP_CMD"
  sudo -u ${ssh_user} -H bash -c "cd '$INSTALL_DIR' && ./node_modules/.bin/pm2 save"
fi

# ----------------------------------------------------------------------------
# 3. Caddy in front of 127.0.0.1:3000 (prod mode, Let's Encrypt).
#
# Inlined from scripts/setup-caddy.sh (prod path). The dev / HTTP path lives
# in that script for manual setup; for Terraform we only ship the prod path
# so there's one fewer way to footgun the deploy.
# ----------------------------------------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

cat > /etc/caddy/Caddyfile <<CADDY_EOF
{
	email ${acme_email}
}

${domain} {
	encode gzip

	# === HEADER AUTH SLOT ===
	# Forward-auth providers go here. See packages/providers/header-auth/README.md.

	reverse_proxy 127.0.0.1:3000

	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options    "nosniff"
		Referrer-Policy           "strict-origin-when-cross-origin"
		Permissions-Policy        "geolocation=(), microphone=(), camera=()"
		-Server
	}

	@static path /assets/*
	header @static Cache-Control "public, max-age=31536000, immutable"
	@api path /api/*
	header @api Cache-Control "no-cache, no-store, must-revalidate"

	request_body {
		max_size 100mb
	}

	log {
		output file /var/log/caddy/access.log
		format json
	}
}

www.${domain} {
	redir https://${domain}{uri} permanent
}
CADDY_EOF

# The Debian package leaves /var/log/caddy root-owned; the service runs as
# user `caddy`. Without this chown, Caddy fails to start.
mkdir -p /var/log/caddy
chown -R caddy:caddy /var/log/caddy

caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "=== Selva startup script complete ==="
echo ""
echo "App:    https://${domain}"
echo "Health: https://${domain}/api/health"
