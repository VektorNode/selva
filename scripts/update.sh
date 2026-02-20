#!/bin/bash

################################################################################
# Selva Compute App - Update Script
################################################################################
# Automates pulling latest changes and rebuilding the application.
# Uses PM2 for zero-downtime updates when available.
#
# Usage: bash update.sh [--no-restart] [--branch <branch>]
#        bash update.sh --no-restart          # Skip PM2 restart
#        bash update.sh --branch main         # Switch to and update a specific branch
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="${INSTALL_DIR:-$HOME/selva}"
NO_RESTART=false
TARGET_BRANCH=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-restart) NO_RESTART=true; shift ;;
    --branch) TARGET_BRANCH="$2"; shift 2 ;;
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

# Check if directory exists
if [ ! -d "$INSTALL_DIR" ]; then
  print_error "Installation directory not found: $INSTALL_DIR"
  echo "Run setup.sh first to initialize the installation."
  exit 1
fi

################################################################################
# 1. CHECK STATUS
################################################################################
print_header "Selva Compute App - Update"

print_step "Checking current status..."
cd "$INSTALL_DIR"

# Get current branch and commit
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
CURRENT_COMMIT=$(git rev-parse --short HEAD)
print_success "Current branch: $CURRENT_BRANCH"
print_success "Current commit: $CURRENT_COMMIT"

# Switch to target branch if specified
if [ -n "$TARGET_BRANCH" ] && [ "$TARGET_BRANCH" != "$CURRENT_BRANCH" ]; then
  print_step "Switching to branch: $TARGET_BRANCH..."
  git fetch origin
  if git checkout "$TARGET_BRANCH" 2>/dev/null || git checkout -b "$TARGET_BRANCH" --track "origin/$TARGET_BRANCH" 2>/dev/null; then
    CURRENT_BRANCH="$TARGET_BRANCH"
    CURRENT_COMMIT=$(git rev-parse --short HEAD)
    print_success "Switched to branch: $CURRENT_BRANCH"
  else
    print_error "Failed to switch to branch: $TARGET_BRANCH"
    exit 1
  fi
fi

# Check if PM2 is managing the app
PM2_RUNNING=false
if command -v pm2 >/dev/null 2>&1; then
  if pm2 list | grep -q "selva-compute"; then
    PM2_RUNNING=true
    print_success "PM2 is managing the application"
  fi
fi

################################################################################
# 2. PULL LATEST CHANGES
################################################################################
print_header "Step 1: Pulling Latest Changes"

print_step "Fetching from remote..."
git fetch origin

# Check if there are changes
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/$CURRENT_BRANCH)

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  print_warning "Already up to date!"
  echo ""
  echo "Latest commit: $(git log -1 --pretty=format:'%h - %s (%ar)')"
  exit 0
fi

print_step "Pulling changes from origin/$CURRENT_BRANCH..."
git pull origin $CURRENT_BRANCH

NEW_COMMIT=$(git rev-parse --short HEAD)
print_success "Updated to: $NEW_COMMIT"
echo ""
git log --oneline -5

################################################################################
# 3. INSTALL DEPENDENCIES
################################################################################
print_header "Step 2: Installing Dependencies"

print_step "Running pnpm install..."
pnpm install
print_success "Dependencies updated"

################################################################################
# 4. BUILD
################################################################################
print_header "Step 3: Building Application"

print_step "Building shared package..."
cd "$INSTALL_DIR"
pnpm run build:shared
print_success "Shared package built"

print_step "Building compute-app for production..."
cd "$INSTALL_DIR/packages/compute-app"
export ADAPTER=node
pnpm build
print_success "Compute-app built"

################################################################################
# 5. RESTART APPLICATION
################################################################################
if [ "$NO_RESTART" = false ]; then
  print_header "Step 4: Restarting Application"

  if [ "$PM2_RUNNING" = true ]; then
    print_step "Restarting with PM2..."
    pm2 restart selva-compute --update-env

    # Wait for restart
    sleep 2

    # Check status
    PM2_STATUS=$(pm2 describe selva-compute | grep -oP "status\s+:\s+\K\w+" || echo "unknown")
    if [ "$PM2_STATUS" = "online" ]; then
      print_success "Application restarted successfully"
      pm2 status
    else
      print_error "Application failed to restart. Check logs:"
      echo ""
      pm2 logs selva-compute --lines 20
      exit 1
    fi
  else
    print_warning "PM2 is not managing the application"
    print_step "To start manually, run:"
    echo "cd $INSTALL_DIR/packages/compute-app && npm start"
  fi
else
  print_warning "Application restart skipped (--no-restart flag set)"
  print_step "Restart manually with:"
  echo "pm2 restart selva-compute --update-env"
fi

################################################################################
# 6. HEALTH CHECK
################################################################################
print_header "Verification"

if [ "$PM2_RUNNING" = true ]; then
  print_step "Running health check..."

  # Get port from .env
  PORT=$(grep "^PORT=" "$INSTALL_DIR/packages/compute-app/.env" | cut -d'=' -f2 | tr -d ' ')
  PORT=${PORT:-3000}

  # Wait a moment for server to be ready
  sleep 1

  if curl -s http://localhost:$PORT/api/health > /dev/null; then
    print_success "Health check passed"
    echo "Server is running and responding to requests"
  else
    print_warning "Health check failed - server may still be starting"
    print_step "Check logs with: pm2 logs selva-compute"
  fi
fi

################################################################################
# COMPLETION
################################################################################
print_header "Update Complete!"

echo -e "${GREEN}Selva Compute App has been updated.${NC}"
echo ""
echo "📝 Changelog:"
git log --oneline origin/$CURRENT_BRANCH..$CURRENT_BRANCH..origin/$CURRENT_BRANCH | head -5 || echo "   (No changes from previous version)"
echo ""

if [ "$PM2_RUNNING" = true ]; then
  echo "📊 Application Status:"
  pm2 status
  echo ""
  echo "📋 Recent Logs:"
  pm2 logs selva-compute --lines 10
  echo ""
fi

print_success "Update script completed successfully!"
