#!/bin/bash

################################################################################
# Selva Compute App - Caddy Reverse Proxy Setup
################################################################################
# Sets up Caddy as a reverse proxy in front of the Selva Compute App.
# Run this after setup.sh has deployed the app.
#
# Usage: bash setup-caddy.sh [--domain DOMAIN] [--port PORT]
#        bash setup-caddy.sh                        # HTTP on port 80
#        bash setup-caddy.sh --domain app.example.com  # HTTPS via Let's Encrypt
#        bash setup-caddy.sh --port 4000            # Custom app port
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

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --domain) CADDY_DOMAIN="$2"; shift 2 ;;
    --port)   APP_PORT="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

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

# Resolve app port: flag > .env > default
if [ -z "$APP_PORT" ]; then
  ENV_FILE="$INSTALL_DIR/packages/compute-app/.env"
  if [ -f "$ENV_FILE" ]; then
    APP_PORT=$(grep "^PORT=" "$ENV_FILE" | cut -d'=' -f2 | tr -d ' ')
    [ -n "$APP_PORT" ] && print_success "Read app port from .env: $APP_PORT"
  fi
  APP_PORT=${APP_PORT:-3000}
fi

print_success "Proxying to localhost:$APP_PORT"

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

if [ -n "$CADDY_DOMAIN" ]; then
  sudo tee "$CADDYFILE" > /dev/null << EOF
$CADDY_DOMAIN {
    reverse_proxy localhost:$APP_PORT
}
EOF
  print_success "Caddy configured for $CADDY_DOMAIN (automatic HTTPS via Let's Encrypt)"
  print_warning "Make sure ports 80 and 443 are open in your firewall"
  ACCESS_URL="https://$CADDY_DOMAIN"
else
  sudo tee "$CADDYFILE" > /dev/null << EOF
:80 {
    reverse_proxy localhost:$APP_PORT
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
