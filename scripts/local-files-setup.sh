#!/bin/bash

################################################################################
# Selva Local Files Setup
################################################################################
# One-time setup to prevent local-only files (like definitions-config.json)
# from being tracked by git and synced during updates.
#
# This script removes these files from git's tracking while keeping your
# local copies intact.
#
# Usage: bash local-files-setup.sh
################################################################################

set -eo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
  echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_step() {
  echo -e "\n${BLUE}→ $1${NC}"
}

INSTALL_DIR="${INSTALL_DIR:-$HOME/selva}"

if [ ! -d "$INSTALL_DIR/.git" ]; then
  echo -e "${RED}✗ Not a git repository: $INSTALL_DIR${NC}"
  exit 1
fi

cd "$INSTALL_DIR"

print_header "Selva Local Files Setup"

print_step "Untracking local-only files from git..."

# Files that should NEVER be synced
LOCAL_ONLY_FILES=(
  "packages/compute-app/example-definitions/definitions-config.json"
  "packages/compute-app/definitions"
)

CHANGED_COUNT=0
for FILE in "${LOCAL_ONLY_FILES[@]}"; do
  if git ls-files --error-unmatch "$FILE" 2>/dev/null; then
    print_warning "Removing from git tracking: $FILE"
    git rm --cached -r -f "$FILE"
    CHANGED_COUNT=$((CHANGED_COUNT + 1))
  else
    print_step "Already untracked: $FILE"
  fi
done

if [ $CHANGED_COUNT -gt 0 ]; then
  print_step "Committing changes..."
  git add .gitignore
  git commit -m "chore: stop tracking local-only definition files

- Remove definitions-config.json from git tracking
- Keep local copies on disk (not synced)
- Prevents merge conflicts during updates
- Files are protected by .gitignore going forward"
  print_success "Changes committed"
else
  print_success "All local files already untracked"
fi

print_header "Verification"

print_step "Checking .gitignore..."
if grep -q "definitions-config.json" .gitignore; then
  print_success ".gitignore properly configured"
else
  print_warning ".gitignore not yet updated"
fi

print_step "Checking git status..."
git status --short

print_header "Setup Complete!"

echo -e "${GREEN}Local files are now protected from sync.${NC}"
echo ""
echo "Your local definitions config is preserved:"
if [ -f "packages/compute-app/example-definitions/definitions-config.json" ]; then
  echo -e "  ${GREEN}✓${NC} packages/compute-app/example-definitions/definitions-config.json"
fi
echo ""
echo "These files will NEVER be synced during updates."
print_success "Done!"
