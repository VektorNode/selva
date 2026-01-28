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
#
# Usage: bash setup.sh [--interactive] [--skip-pm2]
#        bash setup.sh --interactive   # Prompts for all config values
#        bash setup.sh --skip-pm2      # Skips PM2 setup
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="${REPO_URL:-git@github.com:VektorNode/selva.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/selva}"
INTERACTIVE=false
SKIP_PM2=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --interactive) INTERACTIVE=true; shift ;;
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
    npm install -g pnpm@latest
  fi
else
  print_step "Installing pnpm..."
  npm install -g pnpm
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

if [ -d "$INSTALL_DIR" ]; then
  print_warning "Directory already exists: $INSTALL_DIR"
  print_step "Pulling latest changes..."
  cd "$INSTALL_DIR"
  git pull origin main || print_warning "Could not pull (may be offline or no main branch)"
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
CONFIG_FILE="$INSTALL_DIR/packages/compute-app/ecosystem.config.cjs"

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
    read -p "Grasshopper Definitions Source [filesystem]: " DEFINITION_SOURCE
    DEFINITION_SOURCE=${DEFINITION_SOURCE:-filesystem}

    if [ "$DEFINITION_SOURCE" = "filesystem" ]; then
      read -p "Path to definitions directory [./definitions]: " GH_DEFINITIONS_PATH
      GH_DEFINITIONS_PATH=${GH_DEFINITIONS_PATH:-./definitions}
    fi

    read -p "Rhino.Compute Server URL [http://localhost:5000]: " COMPUTE_SERVER_URL
    COMPUTE_SERVER_URL=${COMPUTE_SERVER_URL:-http://localhost:5000}

    read -p "Rhino.Compute API Key (optional, press Enter to skip): " COMPUTE_API_KEY

    read -p "Application Port [3000]: " PORT
    PORT=${PORT:-3000}

    DEFAULT_ORIGIN="http://$PUBLIC_IP:$PORT"
    read -p "Public Origin URL [$DEFAULT_ORIGIN]: " ORIGIN
    ORIGIN=${ORIGIN:-$DEFAULT_ORIGIN}
  else
    # Use defaults for non-interactive mode
    DEFINITION_SOURCE="filesystem"
    GH_DEFINITIONS_PATH="./example-definitions"
    COMPUTE_SERVER_URL="http://localhost:5000"
    COMPUTE_API_KEY=""
    PORT="3000"
    ORIGIN="http://$PUBLIC_IP:$PORT"
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

  if [ -n "$COMPUTE_API_KEY" ]; then
    cat >> "$ENV_FILE" << EOF
COMPUTE_API_KEY="${COMPUTE_API_KEY}"
EOF
  fi

  cat >> "$ENV_FILE" << EOF

# Server Configuration
PORT=${PORT}
ORIGIN="${ORIGIN}"

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

print_step "Building all packages..."
cd "$INSTALL_DIR"
pnpm run build:all
print_success "All packages built"

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

  # Create ecosystem config (update if exists to reflect .env changes)
  print_step "Creating/updating ecosystem.config.cjs..."

  # Extract values from .env
  PORT=$(grep "^PORT=" "$ENV_FILE" | cut -d'=' -f2 | tr -d ' ')
  ORIGIN=$(grep "^ORIGIN=" "$ENV_FILE" | cut -d'"' -f2)
  COMPUTE_SERVER_URL=$(grep "COMPUTE_SERVER_URL=" "$ENV_FILE" | cut -d'"' -f2)
  COMPUTE_API_KEY=$(grep "COMPUTE_API_KEY=" "$ENV_FILE" | cut -d'"' -f2 2>/dev/null)
  GH_DEFINITIONS_PATH=$(grep "GH_DEFINITIONS_PATH=" "$ENV_FILE" | cut -d'"' -f2)

  PORT=${PORT:-3000}
  ORIGIN=${ORIGIN:-http://localhost:$PORT}

  if [ ! -f "$CONFIG_FILE" ]; then

    cat > "$CONFIG_FILE" << 'EOF'
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
			cwd: '__CWD__',
			env: {
				PORT: __PORT__,
				ORIGIN: '__ORIGIN__',
				COMPUTE_SERVER_URL: '__COMPUTE_SERVER_URL__',
				BODY_SIZE_LIMIT: 'Infinity',
				__GH_DEFINITIONS__
				__COMPUTE_API_KEY__
				NODE_ENV: 'production'
			}
		}
	]
};
EOF

    # Replace placeholders
    sed -i "s|__CWD__|$INSTALL_DIR/packages/compute-app|g" "$CONFIG_FILE"
    sed -i "s/__PORT__/$PORT/g" "$CONFIG_FILE"
    sed -i "s|__ORIGIN__|$ORIGIN|g" "$CONFIG_FILE"
    sed -i "s|__COMPUTE_SERVER_URL__|$COMPUTE_SERVER_URL|g" "$CONFIG_FILE"

    if [ -n "$COMPUTE_API_KEY" ]; then
      sed -i "s|__COMPUTE_API_KEY__|COMPUTE_API_KEY: '$COMPUTE_API_KEY',|g" "$CONFIG_FILE"
    else
      sed -i "s|__COMPUTE_API_KEY__|// No API key configured|g" "$CONFIG_FILE"
    fi

    if [ -n "$GH_DEFINITIONS_PATH" ]; then
      sed -i "s|__GH_DEFINITIONS__|GH_DEFINITIONS_PATH: '$GH_DEFINITIONS_PATH',|g" "$CONFIG_FILE"
    else
      sed -i "s|__GH_DEFINITIONS__|// Using environment variable definitions|g" "$CONFIG_FILE"
    fi

    print_success "ecosystem.config.cjs created: $CONFIG_FILE"
  else
    print_success "Updated ecosystem.config.cjs with current .env values"
  fi

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
    sudo pm2 startup systemd -u $USER --hp $HOME
    sudo pm2 save
    print_success "Auto-restart configured"
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

echo -e "${GREEN}Selva Compute App is ready!${NC}"
echo ""
echo "📁 Installation directory: $INSTALL_DIR"
echo "⚙️  Configuration file: $ENV_FILE"
echo "🌍 Server IP Address: $PUBLIC_IP"
echo "🚀 Access application: http://$PUBLIC_IP:$PORT/app?gh=definition-name"
echo "💊 Health check: curl http://$PUBLIC_IP:$PORT/api/health"
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
echo ""

if [ "$SKIP_PM2" = false ]; then
  echo "   pm2 restart selva-compute --update-env"
else
  echo "   To start the app manually:"
  echo "   cd $INSTALL_DIR/packages/compute-app && npm start"
fi

echo ""
print_success "Setup script completed successfully!"
