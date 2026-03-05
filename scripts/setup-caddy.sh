#!/bin/bash

################################################################################
# Selva Compute App - Caddy Reverse Proxy Setup
################################################################################
# Sets up Caddy as a reverse proxy in front of the Selva Compute App.
# Interactive setup: asks if you need production (HTTPS) or development setup.
#
# Usage: bash setup-caddy.sh
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-$HOME/selva}"
CADDY_DOMAIN=""
APP_PORT=""
SETUP_MODE=""

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

print_header "Caddy Reverse Proxy Setup"

# Interactive setup: ask if production or development
print_step "Do you need production setup (HTTPS with custom domain) or development (HTTP)?"
echo "  1) Development (HTTP on port 80, local testing)"
echo "  2) Production (HTTPS with domain, Let's Encrypt SSL)"
read -p "Choose (1 or 2): " setup_choice

case $setup_choice in
  1) SETUP_MODE="dev" ;;
  2) SETUP_MODE="prod" ;;
  *) print_error "Invalid choice"; exit 1 ;;
esac

# Resolve app port: .env > default
ENV_FILE="$INSTALL_DIR/packages/compute-app/.env"
if [ -f "$ENV_FILE" ]; then
  APP_PORT=$(grep "^PORT=" "$ENV_FILE" | cut -d'=' -f2 | tr -d ' ')
  if [ -n "$APP_PORT" ]; then
    read -p "App port from .env is $APP_PORT. Use this? (y/n): " confirm_port
    if [ "$confirm_port" != "y" ]; then
      read -p "Enter app port: " APP_PORT
    fi
  else
    read -p "Enter app port (default 3000): " APP_PORT
    APP_PORT=${APP_PORT:-3000}
  fi
else
  read -p "Enter app port (default 3000): " APP_PORT
  APP_PORT=${APP_PORT:-3000}
fi

# Validate app port
if ! [[ "$APP_PORT" =~ ^[0-9]+$ ]] || [ "$APP_PORT" -lt 1 ] || [ "$APP_PORT" -gt 65535 ]; then
  print_error "Invalid port number (must be 1-65535)"
  exit 1
fi

print_success "Proxying to localhost:$APP_PORT"

# If production, ask for domain and email
if [ "$SETUP_MODE" = "prod" ]; then
  read -p "Enter your domain (e.g., app.example.com): " CADDY_DOMAIN
  if [ -z "$CADDY_DOMAIN" ]; then
    print_error "Domain is required for production setup"
    exit 1
  fi

  # Validate domain format
  if ! [[ "$CADDY_DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
    print_error "Invalid domain format (e.g., app.example.com)"
    exit 1
  fi

  read -p "Enter email for Let's Encrypt renewal notifications: " CADDY_EMAIL
  if [ -z "$CADDY_EMAIL" ]; then
    CADDY_EMAIL="admin@$CADDY_DOMAIN"
    print_warning "Using default email: $CADDY_EMAIL"
  fi

  # Validate email format
  if ! [[ "$CADDY_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    print_error "Invalid email format (e.g., admin@example.com)"
    exit 1
  fi

  print_success "Domain: $CADDY_DOMAIN"
  print_success "Email: $CADDY_EMAIL"
fi

# Install Caddy if not present
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

# Write Caddyfile
CADDYFILE="/etc/caddy/Caddyfile"
print_step "Writing Caddyfile at $CADDYFILE..."

if [ "$SETUP_MODE" = "prod" ]; then
  # Production setup with HTTPS, security headers, logging, caching
  sudo tee "$CADDYFILE" > /dev/null << EOF
$CADDY_DOMAIN {
	# TLS configuration with Let's Encrypt
	tls {
		email $CADDY_EMAIL
	}

	# Reverse proxy to compute app
	reverse_proxy localhost:$APP_PORT {
		header_up X-Forwarded-Proto "https"
		header_up X-Forwarded-Host {http.request.host}
		header_up X-Real-IP {http.request.remote.host}
	}

	# Enable gzip compression
	encode gzip

	# Security headers
	header / Strict-Transport-Security "max-age=31536000; includeSubDomains"
	header / X-Content-Type-Options nosniff
	header / X-Frame-Options DENY
	header / X-XSS-Protection "1; mode=block"
	header / Referrer-Policy "strict-origin-when-cross-origin"
	header / Permissions-Policy "geolocation=(), microphone=(), camera=()"

	# Cache control for static assets
	@static {
		path /assets/*
	}
	header @static Cache-Control "public, max-age=31536000, immutable"

	# Disable caching for API responses
	@api {
		path /api/*
	}
	header @api Cache-Control "no-cache, no-store, must-revalidate"

	# Request size limit
	request_body {
		max_size 100mb
	}

	# Logging (production: write to file)
	log {
		output file /var/log/caddy/compute.log
		format json
	}
}

# Redirect www to non-www
www.$CADDY_DOMAIN {
	redir https://$CADDY_DOMAIN{uri}
}
EOF
  print_success "Caddy configured for $CADDY_DOMAIN (automatic HTTPS via Let's Encrypt)"
  print_warning "Make sure ports 80 and 443 are open in your firewall"
  ACCESS_URL="https://$CADDY_DOMAIN"
else
  # Development setup - simple HTTP
  sudo tee "$CADDYFILE" > /dev/null << EOF
:80 {
	# Reverse proxy to local compute app
	reverse_proxy localhost:$APP_PORT {
		header_up X-Forwarded-Proto "http"
		header_up X-Forwarded-Host {http.request.host}
		header_up X-Real-IP {http.request.remote.host}
	}

	# Enable gzip compression
	encode gzip

	# Security headers
	header / X-Content-Type-Options nosniff
	header / X-Frame-Options DENY
	header / X-XSS-Protection "1; mode=block"
}
EOF
  print_success "Caddy configured as HTTP reverse proxy on port 80 → localhost:$APP_PORT"
  print_warning "Make sure port 80 is open in your firewall"
  PUBLIC_IP=$(curl -s --max-time 5 https://ifconfig.me 2>/dev/null || \
              curl -s --max-time 5 https://icanhazip.com 2>/dev/null || \
              echo "your-server-ip")
  ACCESS_URL="http://$PUBLIC_IP"
fi

# Enable and start Caddy
print_step "Enabling and starting Caddy service..."
sudo systemctl enable caddy
sudo systemctl restart caddy
print_success "Caddy service running"
sudo systemctl status caddy --no-pager | head -10 || true

echo ""
echo -e "${GREEN}Caddy is ready!${NC}"
echo ""
echo "🚀 Access application: $ACCESS_URL"
echo ""
echo "Caddy Commands:"
echo "   sudo systemctl status caddy   - Check status"
echo "   sudo systemctl restart caddy  - Restart"
echo "   sudo journalctl -u caddy -f   - View logs"
echo "   sudo cat $CADDYFILE           - View Caddyfile"
echo ""
print_success "Done!"
