#!/bin/bash

################################################################################
# Selva Compute App - Automated Setup Script
################################################################################
# This script automates the complete setup from zero to production-ready:
# - Checks Node.js and pnpm (installs if missing)
# - Clones/validates repository
# - Installs dependencies
# - Configures environment variables
# - Builds everything
# - Sets up PM2 for production
# - Optionally sets up Caddy as a reverse proxy (with automatic HTTPS)
#
# Provider: this script bootstraps the **local provider** (filesystem + JSON).
# For the Supabase provider, follow packages/supabase-provider/README.md.
#
# Prerequisites: SSH key added to GitHub (repo is private — SSH is used for cloning).
#   ssh-keygen -t ed25519 -C "you@example.com"
#   cat ~/.ssh/id_ed25519.pub  # add to https://github.com/settings/keys
#
# Usage: bash setup.sh [--no-interactive] [--skip-pm2]
#        bash setup.sh                            # Interactive mode (default — prompts for all values)
#        bash setup.sh --no-interactive           # Non-interactive, uses env vars / defaults
#        bash setup.sh --skip-pm2                 # Skips PM2 setup
#
# For Caddy reverse proxy, run setup-caddy.sh separately after this script.
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration (all overridable via environment variables)
REPO_URL="${REPO_URL:-git@github.com:VektorNode/selva.git}"
# Branch / tag / commit to deploy. Defaults to main; override with BRANCH=9x
# (or any ref) to deploy a feature branch.
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/selva}"
# DATA_PATH is the local provider's data directory: users.json, orgs/projects/
# definitions JSON, compute.config.json, and uploaded .gh files. Resolved
# relative to packages/selva/ — the default lands at .selva-data/ at
# the repo root.
DATA_PATH="${DATA_PATH:-../../.selva-data}"
SELVA_HMAC_KEY="${SELVA_HMAC_KEY:-}"
SELVA_AT_REST_KEY="${SELVA_AT_REST_KEY:-}"
ALLOW_INSECURE_COOKIES="${ALLOW_INSECURE_COOKIES:-}"  # auto-detected: true for http, false for https
# Always bind to loopback. The VM is fronted by Caddy on the public interface;
# the app process must NOT be reachable directly from the network. This is a
# hard requirement for forward-auth providers (header-auth-provider/README.md)
# and good hygiene generally.
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
# DOMAIN is set by the Terraform startup script in production. If present,
# ORIGIN is derived as https://$DOMAIN; otherwise we fall back to the public
# IP for local-network testing.
DOMAIN="${DOMAIN:-}"
ORIGIN="${ORIGIN:-}"  # auto-detected from DOMAIN / public IP if not set
INTERACTIVE=true
SKIP_PM2=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-interactive) INTERACTIVE=false; shift ;;
    --skip-pm2) SKIP_PM2=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Helper functions
print_header() {
  echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_step() {
  echo -e "\n${BLUE}→ $1${NC}"
}

# Check if command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Get public IP address
get_public_ip() {
  # Try multiple services for redundancy
  curl -s --max-time 5 https://ifconfig.me 2>/dev/null || \
  curl -s --max-time 5 https://icanhazip.com 2>/dev/null || \
  curl -s --max-time 5 https://checkip.amazonaws.com 2>/dev/null || \
  echo "localhost"
}

################################################################################
# 1. SYSTEM CHECKS & REQUIREMENTS
################################################################################
print_header "Step 1: System Requirements Check"

# Check Node.js
if command_exists node; then
  NODE_VERSION=$(node -v)
  print_success "Node.js found: $NODE_VERSION"
  # Check version >= 18
  NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    print_error "Node.js 18.0.0 or higher required (found $NODE_VERSION)"
    exit 1
  fi
else
  print_error "Node.js not found. Installing Node.js..."
  if command_exists apt-get; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command_exists brew; then
    brew install node
  elif command_exists yum; then
    sudo yum install -y nodejs
  else
    print_error "Cannot auto-install Node.js on this system. Please install Node.js 18+ manually."
    exit 1
  fi
  print_success "Node.js installed: $(node -v)"
fi

# Enable Corepack — it ships with Node 16.10+ and manages package-manager
# versions per project. The exact pnpm version is pinned in package.json's
# `packageManager` field, which Corepack reads when we run pnpm from inside
# the repo. Single source of truth across dev / CI / prod.
if ! command_exists corepack; then
  print_error "corepack not found. Update Node.js to 16.10+ (current: $(node -v))."
  exit 1
fi
print_step "Enabling Corepack..."
sudo corepack enable
print_success "Corepack enabled (pnpm version will be activated after clone)"

# Check git
if ! command_exists git; then
  print_error "git not found. Please install git first."
  exit 1
fi
print_success "git found: $(git --version)"

################################################################################
# 2. REPOSITORY SETUP
################################################################################
print_header "Step 2: Repository Setup"

if [ -d "$INSTALL_DIR" ] && [ -d "$INSTALL_DIR/.git" ]; then
  print_warning "Directory already exists: $INSTALL_DIR"
  print_step "Fetching and switching to $BRANCH..."
  cd "$INSTALL_DIR"
  git fetch origin "$BRANCH" || print_warning "Could not fetch $BRANCH (may be offline)"
  git checkout "$BRANCH"
  git pull origin "$BRANCH" || print_warning "Could not pull $BRANCH"
elif [ -d "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  print_warning "Directory exists but is not a git repo (leftover from failed clone) — removing..."
  rm -rf "$INSTALL_DIR"
  print_step "Cloning repository ($BRANCH)..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  print_success "Repository cloned to $INSTALL_DIR ($BRANCH)"
else
  print_step "Cloning repository ($BRANCH)..."
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  print_success "Repository cloned to $INSTALL_DIR ($BRANCH)"
fi

################################################################################
# 3. DEPENDENCY INSTALLATION
################################################################################
print_header "Step 3: Installing Dependencies"

# Activate the pnpm version pinned in package.json's `packageManager` field.
# Corepack reads it and downloads/uses that exact version — no drift.
print_step "Activating pnpm via Corepack..."
corepack prepare --activate
print_success "pnpm $(pnpm -v) activated"

print_step "Running pnpm install..."
pnpm install --frozen-lockfile
print_success "Dependencies installed"

################################################################################
# 4. ENVIRONMENT CONFIGURATION
################################################################################
print_header "Step 4: Environment Configuration"

ENV_FILE="$INSTALL_DIR/packages/selva/.env"
CONFIG_FILE="$INSTALL_DIR/ecosystem.config.cjs"

# Decide whether to (re)write .env. Fresh install always writes; existing
# install only rewrites if the user opts in interactively.
RECONFIGURE=false
if [ ! -f "$ENV_FILE" ]; then
  RECONFIGURE=true
elif [ "$INTERACTIVE" = true ]; then
  print_warning "Environment file already exists: $ENV_FILE"
  read -p "Do you want to reconfigure? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    RECONFIGURE=true
  else
    print_step "Keeping existing environment configuration"
  fi
else
  print_step "Environment file exists — keeping as-is (run interactively to reconfigure)"
fi

if [ "$RECONFIGURE" = true ]; then
  print_step "Configuring environment variables..."

  # Detect public IP address (fallback when no DOMAIN is provided)
  print_step "Detecting public IP address..."
  PUBLIC_IP=$(get_public_ip)
  if [ "$PUBLIC_IP" != "localhost" ]; then
    print_success "Public IP detected: $PUBLIC_IP"
  else
    print_warning "Could not detect public IP, will use localhost"
  fi

  # Compute default ORIGIN: prefer DOMAIN (https) over public IP (http).
  if [ -z "$ORIGIN" ]; then
    if [ -n "$DOMAIN" ]; then
      ORIGIN="https://$DOMAIN"
    else
      ORIGIN="http://$PUBLIC_IP"
    fi
  fi

  # Get user input with defaults
  if [ "$INTERACTIVE" = true ]; then
    read -p "Local provider data directory (DATA_PATH) [$DATA_PATH]: " _INPUT
    DATA_PATH="${_INPUT:-$DATA_PATH}"

    print_step "Rhino.Compute URL + API key are configured post-install at /admin/compute."
    print_step "First admin user is created via the in-app setup page on first boot."

    read -p "HMAC signing key for sessions + tokens (optional, press Enter to auto-generate) [${SELVA_HMAC_KEY:-auto}]: " _INPUT
    SELVA_HMAC_KEY="${_INPUT:-$SELVA_HMAC_KEY}"

    read -p "Application Port [$PORT]: " _INPUT
    PORT="${_INPUT:-$PORT}"

    read -p "Public Origin URL [$ORIGIN]: " _INPUT
    ORIGIN="${_INPUT:-$ORIGIN}"
  fi

  # Create .env file
  cat > "$ENV_FILE" << EOF
# ============================================================================
# COMPUTE-APP ENVIRONMENT VARIABLES
# Auto-generated by setup.sh on $(date)
# ============================================================================

# Local provider: directory holding users.json, orgs/projects/definitions JSON,
# compute.config.json, and uploaded .gh files.
DATA_PATH="${DATA_PATH}"

EOF

  # Rhino.Compute server URL + API key are configured post-install via /admin/compute
  # and persisted by the data provider — not written to .env.
  # First admin user is created via the in-app setup page on first boot.

  # Auto-generate SELVA_HMAC_KEY (signs session cookies + share-link / invite tokens).
  if [ -z "$SELVA_HMAC_KEY" ]; then
    SELVA_HMAC_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    print_success "SELVA_HMAC_KEY auto-generated"
  fi

  # Auto-generate SELVA_AT_REST_KEY (AES-256-GCM key that encrypts the
  # Rhino.Compute API key at rest in compute.config.json). Must be stable
  # across restarts — rotating it makes existing encrypted secrets
  # unreadable, requiring re-entry via /admin/compute.
  if [ -z "$SELVA_AT_REST_KEY" ]; then
    SELVA_AT_REST_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    print_success "SELVA_AT_REST_KEY auto-generated"
  fi
  cat >> "$ENV_FILE" << EOF
SELVA_HMAC_KEY="${SELVA_HMAC_KEY}"
SELVA_AT_REST_KEY="${SELVA_AT_REST_KEY}"
EOF

  # Auto-detect ALLOW_INSECURE_COOKIES based on protocol if not set
  if [ -z "$ALLOW_INSECURE_COOKIES" ]; then
    if [[ "$ORIGIN" == https://* ]]; then
      ALLOW_INSECURE_COOKIES="false"
    else
      ALLOW_INSECURE_COOKIES="true"
    fi
  fi

  cat >> "$ENV_FILE" << EOF

# Server Configuration
# HOST=127.0.0.1 keeps the app off the public interface — Caddy is the only
# ingress. Override only for local-network testing where Caddy is not in front.
HOST=${HOST}
PORT=${PORT}
ORIGIN="${ORIGIN}"
ALLOW_INSECURE_COOKIES="${ALLOW_INSECURE_COOKIES}"

# Request body size limit for large geometry uploads. Sized to the largest
# legitimate payload (a big .gh upload + image). Don't set "Infinity" in
# production — every JSON endpoint inherits this cap and an unbounded body
# is a DoS vector on routes that lack their own per-route cap.
BODY_SIZE_LIMIT=150M

# Installation directory — used by the admin dashboard's update endpoint
# to locate scripts/update.sh. Without this, updates triggered from the UI
# fall back to process.cwd() which only works when PM2 was started from
# the repo root.
INSTALL_DIR="${INSTALL_DIR}"
EOF

  print_success "Environment file created: $ENV_FILE"
  cat "$ENV_FILE"
fi

# Create the local provider data directory if it doesn't exist
DATA_PATH_FROM_ENV=$(grep "^DATA_PATH=" "$ENV_FILE" | cut -d'"' -f2)
if [ -n "$DATA_PATH_FROM_ENV" ]; then
  if [[ "$DATA_PATH_FROM_ENV" = /* ]]; then
    DATA_DIR="$DATA_PATH_FROM_ENV"
  else
    DATA_DIR="$INSTALL_DIR/packages/selva/$DATA_PATH_FROM_ENV"
  fi
  if [ ! -d "$DATA_DIR" ]; then
    mkdir -p "$DATA_DIR"
    print_success "Created data directory: $DATA_DIR"
    print_warning "Add your .gh files to: $DATA_DIR"
  fi
fi

################################################################################
# 5. BUILD
################################################################################
print_header "Step 5: Building Application"

print_step "Building compute-app and all workspace dependencies..."
cd "$INSTALL_DIR"
export ADAPTER=node
pnpm build --filter=@selvajs/selva
print_success "Compute-app built for production"

################################################################################
# 6. PM2 SETUP (Optional)
################################################################################
if [ "$SKIP_PM2" = false ]; then
  print_header "Step 6: PM2 Production Manager Setup"

  # Check if PM2 is installed globally
  if ! command_exists pm2; then
    print_step "Installing PM2 globally..."
    sudo npm install -g pm2
    print_success "PM2 installed"
  else
    print_success "PM2 found: $(pm2 -v)"
  fi

  # Generate ecosystem.config.cjs
  print_step "Writing ecosystem.config.cjs..."

  # Runtime config is loaded from .env via Node's --env-file flag (Node >= 20.6).
  # Any var added there (including provider-specific ones like SUPABASE_URL)
  # flows through without touching this script. NODE_ENV is the only thing
  # pinned here. PM2's own `env_file` option is intentionally NOT used — it
  # only works under `pm2-runtime` and is silently ignored by `pm2 start`.
  cat > "$CONFIG_FILE" << EOF
// PM2 process file — auto-generated by setup.sh on $(date).
// Runtime config is loaded from packages/selva/.env via Node's
// --env-file flag (Node >= 20.6). PM2's env_file option is unreliable
// outside pm2-runtime, so we let Node load .env directly.
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: './build/index.js',
			cwd: '$INSTALL_DIR/packages/selva',
			node_args: '--env-file=$ENV_FILE',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			watch: false,
			max_memory_restart: '1G',
			env: {
				NODE_ENV: 'production'
			}
		}
	]
};
EOF

  print_success "ecosystem.config.cjs written: $CONFIG_FILE"

  print_step "Starting application with PM2..."
  cd "$INSTALL_DIR/packages/selva"

  # Stop if already running
  pm2 delete selva-compute 2>/dev/null || true

  # Start application
  pm2 start "$CONFIG_FILE"
  pm2 save

  # Set up auto-restart on reboot
  print_step "Setting up auto-restart on reboot..."
  if command_exists sudo; then
    # pm2 startup prints the exact command to run with sudo — capture both stdout and stderr
    STARTUP_CMD=$(pm2 startup systemd -u $USER --hp $HOME 2>&1 | grep "sudo env")
    if [ -n "$STARTUP_CMD" ]; then
      eval "$STARTUP_CMD"
      pm2 save
      print_success "Auto-restart configured"
    else
      print_warning "Could not parse PM2 startup command — run 'pm2 startup' manually and execute the printed command"
    fi
  else
    print_warning "Could not configure auto-restart (requires sudo)"
  fi

  print_success "Application started with PM2"
  pm2 status
fi

################################################################################
# COMPLETION
################################################################################
print_header "Setup Complete!"

PORT=$(grep "^PORT=" "$ENV_FILE" | cut -d'=' -f2 | tr -d ' ')
PORT=${PORT:-3000}
# ORIGIN is the public URL the app reports; Caddy proxies to 127.0.0.1:$PORT.
ACCESS_URL=$(grep "^ORIGIN=" "$ENV_FILE" | cut -d'"' -f2)
ACCESS_URL=${ACCESS_URL:-http://localhost:$PORT}

echo -e "${GREEN}Selva Compute App is ready!${NC}"
echo ""
echo "📁 Installation directory: $INSTALL_DIR"
echo "⚙️  Configuration file: $ENV_FILE"
echo "🚀 Access application: $ACCESS_URL/app?gh=definition-name"
echo "💊 Health check: curl $ACCESS_URL/api/health"
echo ""

if [ "$SKIP_PM2" = false ]; then
  echo "📊 PM2 Commands:"
  echo "   pm2 status              - Check application status"
  echo "   pm2 logs selva-compute  - View real-time logs"
  echo "   pm2 restart selva-compute --update-env  - Restart with new env vars"
  echo ""
fi

echo "📝 Next steps:"
echo "   1. Add your .gh files to: ${DATA_DIR:-$INSTALL_DIR/.selva-data}"
echo "   2. Open /admin/compute to register your Rhino.Compute server URL (+ optional API key)"
echo "   3. (Optional) Set up Caddy reverse proxy: bash setup-caddy.sh [--domain app.example.com]"
echo ""

if [ "$SKIP_PM2" = false ]; then
  echo "   pm2 restart selva-compute --update-env"
else
  echo "   To start the app manually:"
  echo "   cd $INSTALL_DIR/packages/selva && npm start"
fi

echo ""
print_success "Setup script completed successfully!"
