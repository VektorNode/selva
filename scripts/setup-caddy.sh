#!/bin/bash

################################################################################
# Selva Compute App - Caddy Reverse Proxy Setup
################################################################################
# Installs Caddy and writes /etc/caddy/Caddyfile in front of the app on
# 127.0.0.1:$APP_PORT.
#
# Two modes:
#
#   prod (default)  HTTPS via Let's Encrypt. Requires DOMAIN + ACME_EMAIL.
#                   The A record for DOMAIN must already point at this VM, or
#                   the first ACME run fails (Caddy retries on its own).
#
#   dev             HTTP on :80 with no TLS. Only for local-network testing.
#                   The app's session cookies will be `Secure=false` — never
#                   run this exposed to the internet.
#
# Usage (non-interactive — Terraform invokes it this way):
#   SETUP_MODE=prod DOMAIN=app.example.dev ACME_EMAIL=you@example.dev \
#     APP_PORT=3000 bash setup-caddy.sh
#
# Usage (interactive):
#   bash setup-caddy.sh
################################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-$HOME/selva}"
SETUP_MODE="${SETUP_MODE:-}"
DOMAIN="${DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
APP_PORT="${APP_PORT:-}"

print_header() {
  echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}\n"
}
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error()   { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_step()    { echo -e "\n${BLUE}→ $1${NC}"; }
command_exists() { command -v "$1" >/dev/null 2>&1; }

# Whether all required prod inputs are present in the environment.
# When true, the script runs non-interactively (Terraform / CI path).
NONINTERACTIVE=false
if [ "$SETUP_MODE" = "prod" ] && [ -n "$DOMAIN" ] && [ -n "$ACME_EMAIL" ] && [ -n "$APP_PORT" ]; then
  NONINTERACTIVE=true
fi

print_header "Caddy Reverse Proxy Setup"

# ----------------------------------------------------------------------------
# 1. Mode
# ----------------------------------------------------------------------------
if [ -z "$SETUP_MODE" ]; then
  print_step "Production (HTTPS, requires a domain) or development (HTTP)?"
  echo "  1) Production — HTTPS via Let's Encrypt (recommended)"
  echo "  2) Development — HTTP on port 80, no TLS"
  read -p "Choose (1 or 2) [1]: " setup_choice
  setup_choice=${setup_choice:-1}
  case $setup_choice in
    1) SETUP_MODE="prod" ;;
    2) SETUP_MODE="dev"  ;;
    *) print_error "Invalid choice"; exit 1 ;;
  esac
fi

# ----------------------------------------------------------------------------
# 2. App port (always needed)
# ----------------------------------------------------------------------------
if [ -z "$APP_PORT" ]; then
  ENV_FILE="$INSTALL_DIR/packages/selva/.env"
  if [ -f "$ENV_FILE" ]; then
    APP_PORT=$(grep "^PORT=" "$ENV_FILE" | cut -d'=' -f2 | tr -d ' ')
  fi
  if [ -z "$APP_PORT" ]; then APP_PORT=3000; fi
  if [ "$NONINTERACTIVE" = false ]; then
    read -p "App port [$APP_PORT]: " _INPUT
    APP_PORT="${_INPUT:-$APP_PORT}"
  fi
fi
if ! [[ "$APP_PORT" =~ ^[0-9]+$ ]] || [ "$APP_PORT" -lt 1 ] || [ "$APP_PORT" -gt 65535 ]; then
  print_error "Invalid port number (must be 1-65535)"
  exit 1
fi
print_success "Proxying to 127.0.0.1:$APP_PORT"

# ----------------------------------------------------------------------------
# 3. Prod inputs (domain + email)
# ----------------------------------------------------------------------------
if [ "$SETUP_MODE" = "prod" ]; then
  if [ -z "$DOMAIN" ]; then
    read -p "Domain (e.g. app.example.dev): " DOMAIN
  fi
  if [ -z "$DOMAIN" ]; then
    print_error "Domain is required for production"
    exit 1
  fi
  if ! [[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
    print_error "Invalid domain format (e.g. app.example.dev)"
    exit 1
  fi

  if [ -z "$ACME_EMAIL" ]; then
    if [ "$NONINTERACTIVE" = false ]; then
      read -p "Email for Let's Encrypt notices [admin@$DOMAIN]: " ACME_EMAIL
    fi
    ACME_EMAIL=${ACME_EMAIL:-admin@$DOMAIN}
  fi
  if ! [[ "$ACME_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    print_error "Invalid email format"
    exit 1
  fi
  print_success "Domain: $DOMAIN"
  print_success "ACME email: $ACME_EMAIL"
fi

# ----------------------------------------------------------------------------
# 4. Install Caddy (idempotent)
# ----------------------------------------------------------------------------
if ! command_exists caddy; then
  print_step "Installing Caddy..."
  if command_exists apt-get; then
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo apt-get update
    sudo apt-get install -y caddy
  elif command_exists dnf; then
    sudo dnf install -y 'dnf-command(copr)'
    sudo dnf copr enable -y @caddy/caddy
    sudo dnf install -y caddy
  elif command_exists yum; then
    sudo yum install -y yum-plugin-copr
    sudo yum copr enable -y @caddy/caddy
    sudo yum install -y caddy
  else
    print_error "Cannot auto-install Caddy. Install manually: https://caddyserver.com/docs/install"
    exit 1
  fi
  print_success "Caddy installed: $(caddy version)"
else
  print_success "Caddy found: $(caddy version)"
fi

# ----------------------------------------------------------------------------
# 5. Write Caddyfile
# ----------------------------------------------------------------------------
# Caddy v2 sets X-Forwarded-{For,Proto,Host} on `reverse_proxy` by default —
# no `header_up` lines needed. Strip-then-set hygiene matters only when a
# downstream provider trusts request headers (e.g. forward-auth). The
# `# === HEADER AUTH SLOT ===` block is the insertion point for that work
# without disturbing anything else.

CADDYFILE="/etc/caddy/Caddyfile"
print_step "Writing $CADDYFILE..."

if [ "$SETUP_MODE" = "prod" ]; then
  sudo tee "$CADDYFILE" > /dev/null << EOF
# Global ACME email — applies to every site below.
{
	email $ACME_EMAIL
}

$DOMAIN {
	encode gzip

	# === HEADER AUTH SLOT ===
	# Forward-auth providers go here. See packages/header-auth-provider/README.md.
	# Leave empty until you wire one in.

	reverse_proxy 127.0.0.1:$APP_PORT

	# Browser hardening. The app sets its own response headers too — these
	# are the network-edge layer for things the app process can't enforce
	# (HSTS, COOP/COEP if you need them later).
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options    "nosniff"
		Referrer-Policy           "strict-origin-when-cross-origin"
		Permissions-Policy        "geolocation=(), microphone=(), camera=()"
		-Server
	}

	# Cache static assets aggressively, never cache API responses.
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

# Redirect www → apex.
www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
EOF
  print_success "Caddy configured for https://$DOMAIN"
  print_warning "If the A record for $DOMAIN does not yet point at this server, ACME will retry every few minutes until it does."
  ACCESS_URL="https://$DOMAIN"
else
  # Development — HTTP, no TLS. Session cookies are not Secure.
  sudo tee "$CADDYFILE" > /dev/null << EOF
:80 {
	encode gzip

	# === HEADER AUTH SLOT ===
	# (Not safe in dev mode — forward-auth requires HTTPS.)

	reverse_proxy 127.0.0.1:$APP_PORT

	header {
		X-Content-Type-Options "nosniff"
		Referrer-Policy        "strict-origin-when-cross-origin"
		-Server
	}
}
EOF
  print_success "Caddy configured for http://0.0.0.0:80 → 127.0.0.1:$APP_PORT"
  print_warning "Dev mode — no TLS, cookies are insecure. Do not expose this to the internet."
  PUBLIC_IP=$(curl -s --max-time 5 https://ifconfig.me 2>/dev/null || echo "your-server-ip")
  ACCESS_URL="http://$PUBLIC_IP"
fi

# ----------------------------------------------------------------------------
# 6. Validate + start
# ----------------------------------------------------------------------------
print_step "Validating Caddyfile..."
sudo caddy validate --config "$CADDYFILE"

# Caddy's prod config writes access logs to /var/log/caddy/access.log. The
# Debian package creates /var/log/caddy with root ownership, but the caddy
# service runs as user `caddy` — without this chown, Caddy fails to start
# with "permission denied".
print_step "Preparing Caddy log directory..."
sudo mkdir -p /var/log/caddy
sudo chown -R caddy:caddy /var/log/caddy

print_step "Enabling and starting Caddy..."
sudo systemctl enable caddy
sudo systemctl restart caddy
print_success "Caddy service running"
sudo systemctl status caddy --no-pager | head -10 || true

echo ""
echo -e "${GREEN}Caddy is ready.${NC}"
echo ""
echo "🚀 Access: $ACCESS_URL"
echo ""
echo "Commands:"
echo "   sudo systemctl status caddy   - status"
echo "   sudo systemctl reload caddy   - reload after editing $CADDYFILE"
echo "   sudo journalctl -u caddy -f   - live logs"
echo "   sudo cat $CADDYFILE           - view config"
echo ""
print_success "Done."
