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
INSTALL_DIR="${INSTALL_DIR:-$HOME/selva}"
DEFINITION_SOURCE="${DEFINITION_SOURCE:-filesystem}"
GH_DEFINITIONS_PATH="${GH_DEFINITIONS_PATH:-./definitions}"
COMPUTE_SERVER_URL="${COMPUTE_SERVER_URL:-http://localhost:5000}"
COMPUTE_API_KEY="${COMPUTE_API_KEY:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
SESSION_SECRET="${SESSION_SECRET:-}"
ALLOW_INSECURE_COOKIES="${ALLOW_INSECURE_COOKIES:-}"  # auto-detected: true for http, false for https
PORT="${PORT:-3000}"
ORIGIN="${ORIGIN:-}"  # auto-detected from public IP if not set
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

# Check/install pnpm
if command_exists pnpm; then
  PNPM_VERSION=$(pnpm -v)
  print_success "pnpm found: $PNPM_VERSION"
  PNPM_MAJOR=$(echo $PNPM_VERSION | cut -d'.' -f1)
  if [ "$PNPM_MAJOR" -lt 9 ]; then
    print_warning "pnpm 9.0.0+ recommended (found $PNPM_VERSION), upgrading..."
    sudo npm install -g pnpm@latest
  fi
else
  print_step "Installing pnpm..."
  sudo npm install -g pnpm
  print_success "pnpm installed: $(pnpm -v)"
fi

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
  print_step "Pulling latest changes..."
  cd "$INSTALL_DIR"
  git pull origin main || print_warning "Could not pull (may be offline or no main branch)"
elif [ -d "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  print_warning "Directory exists but is not a git repo (leftover from failed clone) — removing..."
  rm -rf "$INSTALL_DIR"
  print_step "Cloning repository..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  print_success "Repository cloned to $INSTALL_DIR"
else
  print_step "Cloning repository..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  print_success "Repository cloned to $INSTALL_DIR"
fi

################################################################################
# 3. DEPENDENCY INSTALLATION
################################################################################
print_header "Step 3: Installing Dependencies"

print_step "Running pnpm install..."
pnpm install
print_success "Dependencies installed"

################################################################################
# 4. ENVIRONMENT CONFIGURATION
################################################################################
print_header "Step 4: Environment Configuration"

ENV_FILE="$INSTALL_DIR/packages/compute-app/.env"
CONFIG_FILE="$INSTALL_DIR/ecosystem.config.cjs"

# Check if .env already exists
if [ -f "$ENV_FILE" ]; then
  print_warning "Environment file already exists: $ENV_FILE"
  if [ "$INTERACTIVE" = true ]; then
    read -p "Do you want to reconfigure? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      print_step "Skipping environment configuration"
    fi
  else
    print_step "Skipping environment configuration (use --interactive to reconfigure)"
  fi
fi

# Interactive configuration if flag is set or file doesn't exist
if [ ! -f "$ENV_FILE" ] || ([ "$INTERACTIVE" = true ] && [[ $REPLY =~ ^[Yy]$ ]]); then
  print_step "Configuring environment variables..."

  # Detect public IP address
  print_step "Detecting public IP address..."
  PUBLIC_IP=$(get_public_ip)
  if [ "$PUBLIC_IP" != "localhost" ]; then
    print_success "Public IP detected: $PUBLIC_IP"
  else
    print_warning "Could not detect public IP, will use localhost"
  fi

  # Get user input with defaults
  if [ "$INTERACTIVE" = true ]; then
    read -p "Grasshopper Definitions Source [$DEFINITION_SOURCE]: " _INPUT
    DEFINITION_SOURCE="${_INPUT:-$DEFINITION_SOURCE}"

    if [ "$DEFINITION_SOURCE" = "filesystem" ]; then
      read -p "Path to definitions directory [$GH_DEFINITIONS_PATH]: " _INPUT
      GH_DEFINITIONS_PATH="${_INPUT:-$GH_DEFINITIONS_PATH}"
    fi

    read -p "Rhino.Compute Server URL [$COMPUTE_SERVER_URL]: " _INPUT
    COMPUTE_SERVER_URL="${_INPUT:-$COMPUTE_SERVER_URL}"

    while [ -z "$COMPUTE_API_KEY" ]; do
      read -p "Rhino.Compute API Key (required): " _INPUT
      COMPUTE_API_KEY="${_INPUT:-}"
      [ -z "$COMPUTE_API_KEY" ] && print_warning "API key is required."
    done

    read -p "Admin Password (optional, press Enter to skip) [${ADMIN_PASSWORD:-none}]: " _INPUT
    ADMIN_PASSWORD="${_INPUT:-$ADMIN_PASSWORD}"

    read -p "Session Secret (optional, press Enter to auto-generate) [${SESSION_SECRET:-auto}]: " _INPUT
    SESSION_SECRET="${_INPUT:-$SESSION_SECRET}"

    read -p "Application Port [$PORT]: " _INPUT
    PORT="${_INPUT:-$PORT}"

    DEFAULT_ORIGIN="${ORIGIN:-http://$PUBLIC_IP}"
    read -p "Public Origin URL [$DEFAULT_ORIGIN]: " _INPUT
    ORIGIN="${_INPUT:-$DEFAULT_ORIGIN}"
  else
    # Non-interactive: compute ORIGIN if not set
    if [ -z "$ORIGIN" ]; then
      ORIGIN="http://$PUBLIC_IP"
    fi
  fi

  # Create .env file
  cat > "$ENV_FILE" << EOF
# ============================================================================
# COMPUTE-APP ENVIRONMENT VARIABLES
# Auto-generated by setup.sh on $(date)
# ============================================================================

DEFINITION_SOURCE="${DEFINITION_SOURCE}"

EOF

  if [ "$DEFINITION_SOURCE" = "filesystem" ]; then
    cat >> "$ENV_FILE" << EOF
# Local File System: Path to definitions directory
GH_DEFINITIONS_PATH="${GH_DEFINITIONS_PATH}"

EOF
  fi

  cat >> "$ENV_FILE" << EOF
# Rhino.Compute Server Configuration
COMPUTE_SERVER_URL="${COMPUTE_SERVER_URL}"
EOF

  if [ -z "$COMPUTE_API_KEY" ]; then
    print_error "COMPUTE_API_KEY is required but not set."
    exit 1
  fi
  cat >> "$ENV_FILE" << EOF
COMPUTE_API_KEY="${COMPUTE_API_KEY}"
EOF

  if [ -n "$ADMIN_PASSWORD" ]; then
    cat >> "$ENV_FILE" << EOF
ADMIN_PASSWORD="${ADMIN_PASSWORD}"
EOF
  fi

  # Auto-generate SESSION_SECRET if not provided
  if [ -z "$SESSION_SECRET" ]; then
    SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    print_success "SESSION_SECRET auto-generated"
  fi
  cat >> "$ENV_FILE" << EOF
SESSION_SECRET="${SESSION_SECRET}"
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
PORT=${PORT}
ORIGIN="${ORIGIN}"
ALLOW_INSECURE_COOKIES="${ALLOW_INSECURE_COOKIES}"

# Request body size limit for large geometry uploads
BODY_SIZE_LIMIT="Infinity"
EOF

  print_success "Environment file created: $ENV_FILE"
  cat "$ENV_FILE"
fi

# Create definitions directory if using filesystem source
if grep -q "filesystem" "$ENV_FILE"; then
  GH_PATH=$(grep "GH_DEFINITIONS_PATH" "$ENV_FILE" | cut -d'"' -f2)
  if [ -n "$GH_PATH" ]; then
    DEFINITIONS_DIR="$INSTALL_DIR/packages/compute-app/$GH_PATH"
    if [ ! -d "$DEFINITIONS_DIR" ]; then
      mkdir -p "$DEFINITIONS_DIR"
      print_success "Created definitions directory: $DEFINITIONS_DIR"
      print_warning "Add your .gh files to: $DEFINITIONS_DIR"
    fi
  fi
fi

################################################################################
# 5. BUILD
################################################################################
print_header "Step 5: Building Application"

print_step "Building shared package..."
cd "$INSTALL_DIR"
pnpm run build:shared
print_success "Shared package built"

print_step "Building compute-app for production..."
cd "$INSTALL_DIR/packages/compute-app"
export ADAPTER=node
pnpm build
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

  # Re-read vars from .env in case we skipped the config step (file already existed)
  PORT=$(grep "^PORT=" "$ENV_FILE" | cut -d'=' -f2 | tr -d ' ' || echo "$PORT")
  ORIGIN=$(grep "^ORIGIN=" "$ENV_FILE" | cut -d'"' -f2 || echo "$ORIGIN")
  COMPUTE_SERVER_URL=$(grep "^COMPUTE_SERVER_URL=" "$ENV_FILE" | cut -d'"' -f2 || echo "$COMPUTE_SERVER_URL")
  COMPUTE_API_KEY=$(grep "^COMPUTE_API_KEY=" "$ENV_FILE" | cut -d'"' -f2 2>/dev/null || echo "$COMPUTE_API_KEY")
  ADMIN_PASSWORD=$(grep "^ADMIN_PASSWORD=" "$ENV_FILE" | cut -d'"' -f2 2>/dev/null || echo "$ADMIN_PASSWORD")
  SESSION_SECRET=$(grep "^SESSION_SECRET=" "$ENV_FILE" | cut -d'"' -f2 2>/dev/null || echo "$SESSION_SECRET")
  ALLOW_INSECURE_COOKIES=$(grep "^ALLOW_INSECURE_COOKIES=" "$ENV_FILE" | cut -d'"' -f2 2>/dev/null || echo "$ALLOW_INSECURE_COOKIES")
  GH_DEFINITIONS_PATH=$(grep "^GH_DEFINITIONS_PATH=" "$ENV_FILE" | cut -d'"' -f2 2>/dev/null || echo "$GH_DEFINITIONS_PATH")

  PORT=${PORT:-3000}
  ORIGIN=${ORIGIN:-http://localhost}
  ALLOW_INSECURE_COOKIES=${ALLOW_INSECURE_COOKIES:-true}

  # Resolve GH_DEFINITIONS_PATH to absolute path (default to definitions if not set)
  GH_DEFINITIONS_PATH="${GH_DEFINITIONS_PATH:-./definitions}"
  if [[ "$GH_DEFINITIONS_PATH" != /* ]]; then
    ABS_GH_PATH="$INSTALL_DIR/packages/compute-app/$GH_DEFINITIONS_PATH"
  else
    ABS_GH_PATH="$GH_DEFINITIONS_PATH"
  fi

  if [ -z "$COMPUTE_API_KEY" ]; then
    print_error "COMPUTE_API_KEY is required but not set."
    exit 1
  fi

  OPT_ADMIN_PASSWORD=""
  [ -n "$ADMIN_PASSWORD" ] && OPT_ADMIN_PASSWORD="				ADMIN_PASSWORD: '$ADMIN_PASSWORD',"

  cat > "$CONFIG_FILE" << EOF
// This file is used by PM2 to manage the compute app process.
// IMPORTANT: Do not commit sensitive values (API keys, passwords) to version control.
module.exports = {
	apps: [
		{
			name: 'selva-compute',
			script: './packages/compute-app/build/index.js',
			instances: 1,
			exec_mode: 'fork',
			autorestart: true,
			watch: false,
			max_memory_restart: '1G',
			cwd: '$INSTALL_DIR',
			env: {
				PORT: $PORT,
				ORIGIN: '$ORIGIN',
				COMPUTE_SERVER_URL: '$COMPUTE_SERVER_URL',
				COMPUTE_API_KEY: '$COMPUTE_API_KEY',
				BODY_SIZE_LIMIT: 'Infinity',
			GH_DEFINITIONS_PATH: '$ABS_GH_PATH',
$OPT_ADMIN_PASSWORD
				SESSION_SECRET: '$SESSION_SECRET',
				ALLOW_INSECURE_COOKIES: '$ALLOW_INSECURE_COOKIES',
				NODE_ENV: 'production'
			}
		}
	]
};
EOF

  print_success "ecosystem.config.cjs written: $CONFIG_FILE"

  print_step "Starting application with PM2..."
  cd "$INSTALL_DIR/packages/compute-app"

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

# Get the public IP used
PUBLIC_IP=$(get_public_ip)
ACCESS_URL="http://$PUBLIC_IP:$PORT"

echo -e "${GREEN}Selva Compute App is ready!${NC}"
echo ""
echo "📁 Installation directory: $INSTALL_DIR"
echo "⚙️  Configuration file: $ENV_FILE"
echo "🌍 Server IP Address: $PUBLIC_IP"
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
echo "   1. Add your .gh files to: $INSTALL_DIR/packages/compute-app/definitions/"
echo "   2. Update COMPUTE_SERVER_URL in $ENV_FILE if needed"
echo "   3. (Optional) Set up Caddy reverse proxy: bash setup-caddy.sh [--domain app.example.com]"
echo ""

if [ "$SKIP_PM2" = false ]; then
  echo "   pm2 restart selva-compute --update-env"
else
  echo "   To start the app manually:"
  echo "   cd $INSTALL_DIR/packages/compute-app && npm start"
fi

echo ""
print_success "Setup script completed successfully!"
