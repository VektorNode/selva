#!/bin/bash

################################################################################
# Selva Compute App - Update Script
################################################################################
# Automates pulling latest changes and rebuilding the application.
# Uses PM2 graceful reload for zero-downtime updates when available.
#
# Usage: bash update.sh [--no-restart] [--branch <branch>] [--no-pull] [--restart-only]
#        bash update.sh --no-restart          # Skip PM2 restart
#        bash update.sh --branch main         # Switch to and update a specific branch
#        bash update.sh --no-pull             # Skip git pull, only build and restart
#        bash update.sh --restart-only        # Only restart the PM2 process, skip everything else
################################################################################

set -eo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="${INSTALL_DIR:-$HOME/selva}"
NO_RESTART=false
NO_PULL=false
RESTART_ONLY=false
TARGET_BRANCH=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-restart) NO_RESTART=true; shift ;;
    --no-pull) NO_PULL=true; shift ;;
    --restart-only) RESTART_ONLY=true; shift ;;
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

# Prevent concurrent runs
LOCK_FILE="/tmp/selva-update.lock"
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE")
  if kill -0 "$LOCK_PID" 2>/dev/null; then
    print_error "Update already in progress (PID $LOCK_PID). Exiting."
    exit 1
  else
    print_warning "Stale lock file found — removing."
    rm -f "$LOCK_FILE"
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

################################################################################
# 1. CHECK STATUS
################################################################################
print_header "Selva Compute App - Update"

print_step "Checking current status..."
cd "$INSTALL_DIR"

# Get current branch and commit
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL_COMMIT=$(git rev-parse HEAD)
print_success "Current branch: $CURRENT_BRANCH"
print_success "Current commit: $(git rev-parse --short HEAD)"

# Switch to target branch if specified
if [ -n "$TARGET_BRANCH" ] && [ "$TARGET_BRANCH" != "$CURRENT_BRANCH" ]; then
  print_step "Switching to branch: $TARGET_BRANCH..."
  git fetch origin
  if git checkout "$TARGET_BRANCH" 2>/dev/null || git checkout -b "$TARGET_BRANCH" --track "origin/$TARGET_BRANCH" 2>/dev/null; then
    CURRENT_BRANCH="$TARGET_BRANCH"
    LOCAL_COMMIT=$(git rev-parse HEAD)
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

if [ "$RESTART_ONLY" = true ]; then
  print_warning "Restart-only mode — skipping pull, deps, and build"
else

################################################################################
# 2. PULL LATEST CHANGES
################################################################################
if [ "$NO_PULL" = true ]; then
  print_header "Step 1: Skipping Pull (--no-pull)"
  print_warning "Skipping git pull — using current local state"
  echo "Current commit: $(git log -1 --pretty=format:'%h - %s (%ar)')"
else
  print_header "Step 1: Pulling Latest Changes"

  print_step "Fetching from remote..."
  git fetch origin

  # Stash any local changes to avoid pull conflicts
  STASHED=false
  if ! git diff --quiet || ! git diff --cached --quiet; then
    print_warning "Local changes detected — stashing before pull..."
    git stash push -m "update.sh auto-stash $(date +%Y-%m-%d_%H:%M:%S)"
    STASHED=true
  fi

# Check if there are changes
REMOTE_COMMIT=$(git rev-parse origin/$CURRENT_BRANCH)

  if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    print_warning "Already up to date!"
    echo ""
    echo "Latest commit: $(git log -1 --pretty=format:'%h - %s (%ar)')"
    # Restore stash if we stashed before the up-to-date check
    if [ "$STASHED" = true ]; then
      git stash pop || print_warning "Could not restore stash automatically. Run: git stash pop"
    fi
    exit 0
  fi

  print_step "Pulling changes from origin/$CURRENT_BRANCH..."
  if ! git pull origin $CURRENT_BRANCH; then
    # Check if the failure was due to merge conflicts
    if git diff --name-only --diff-filter=U | grep -q .; then
      print_error "Merge conflicts detected! Aborting merge..."
      git merge --abort 2>/dev/null || true
      echo ""
      echo "Conflicting files:"
      git diff --name-only --diff-filter=U
      echo ""
      echo "To resolve manually:"
      echo "  1. cd $INSTALL_DIR"
      echo "  2. git pull origin $CURRENT_BRANCH"
      echo "  3. Resolve conflicts, then: git add . && git commit"
      echo "  4. Re-run: bash update.sh --no-pull"
    else
      print_error "git pull failed. Check your network connection or repository access."
    fi
    # Restore stashed changes before exiting
    if [ "$STASHED" = true ]; then
      print_step "Restoring stashed changes..."
      git stash pop || print_warning "Could not restore stash automatically. Run: git stash pop"
    fi
    exit 1
  fi

  # Restore stashed changes after successful pull
  if [ "$STASHED" = true ]; then
    print_step "Restoring stashed changes..."
    if git stash pop; then
      print_success "Local changes restored"
    else
      print_warning "Stash restore had conflicts — your changes are still in: git stash list"
      print_warning "Resolve manually with: git stash pop"
    fi
  fi

  NEW_COMMIT=$(git rev-parse --short HEAD)
  print_success "Updated to: $NEW_COMMIT"
  echo ""
  git log --oneline -5
fi

################################################################################
# 3. INSTALL DEPENDENCIES
################################################################################
print_header "Step 2: Installing Dependencies"

print_step "Running pnpm install..."
pnpm install --frozen-lockfile
print_success "Dependencies updated"

################################################################################
# 4. BUILD
################################################################################
print_header "Step 3: Building Application"

# Check if shared package has changed since the last build
SHARED_CHANGED=false
if [ "$NO_PULL" = true ]; then
  # No pull means we can't compare commits — assume shared may have changed
  SHARED_CHANGED=true
elif git diff --name-only "$LOCAL_COMMIT" HEAD -- packages/shared | grep -q .; then
  SHARED_CHANGED=true
fi

cd "$INSTALL_DIR"

if [ "$SHARED_CHANGED" = true ]; then
  print_step "Changes detected in shared package — building shared..."
  pnpm run build:shared
  print_success "Shared package built"
else
  print_warning "No changes in packages/shared — skipping shared build"
fi

print_step "Building compute-app for production..."
cd "$INSTALL_DIR/packages/compute-app"
export ADAPTER=node
pnpm build
print_success "Compute-app built"

fi # end of restart-only skip block

################################################################################
# 5. RESTART APPLICATION
################################################################################
if [ "$NO_RESTART" = false ]; then
  print_header "Step 4: Restarting Application"

  if [ "$PM2_RUNNING" = true ]; then
    print_step "Gracefully reloading with PM2..."
    cd "$INSTALL_DIR"
    pm2 reload selva-compute --update-env

    # Wait for restart and check status via JSON to avoid awk parsing fragility
    sleep 3
    PM2_STATUS=$(pm2 jlist 2>/dev/null | node -e "
      const list = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const app = list.find(p => p.name === 'selva-compute');
      process.stdout.write(app ? app.pm2_env.status : 'not-found');
    " 2>/dev/null || echo "unknown")
    if [ "$PM2_STATUS" = "online" ]; then
      print_success "Application restarted successfully"
      pm2 status
    else
      print_error "Application failed to restart (status: $PM2_STATUS). Check logs:"
      echo ""
      pm2 logs selva-compute --lines 20 --nostream
      exit 1
    fi
  else
    print_warning "PM2 is not managing the application"
    print_step "To start manually, run:"
    echo "cd $INSTALL_DIR/packages/compute-app && npm start"
  fi
else
  print_warning "Application restart skipped (--no-restart flag set)"
  print_step "Reload manually with:"
  echo "pm2 reload selva-compute --update-env"
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

  # Retry health check for up to 30 seconds
  HEALTH_OK=false
  for i in $(seq 1 10); do
    if curl -s "http://localhost:$PORT/api/health" > /dev/null; then
      HEALTH_OK=true
      break
    fi
    sleep 3
  done

  if [ "$HEALTH_OK" = true ]; then
    print_success "Health check passed"
    echo "Server is running and responding to requests"
  else
    print_warning "Health check failed after 30s — server may still be starting"
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
git log --oneline "$LOCAL_COMMIT..HEAD" | head -5 || echo "   (No changes from previous version)"
echo ""

if [ "$PM2_RUNNING" = true ]; then
  echo "📊 Application Status:"
  pm2 status
  echo ""
  echo "📋 Recent Logs:"
  pm2 logs selva-compute --lines 10 --nostream
  echo ""
fi

print_success "Update script completed successfully!"
