#!/bin/bash

################################################################################
# Selva Git Recovery Script
################################################################################
# Recovers from common git issues that can block updates:
# - Stale merge/rebase state
# - Local file conflicts
# - Dirty working directory
#
# Usage: bash git-recovery.sh [--aggressive]
#        bash git-recovery.sh           # Safe recovery
#        bash git-recovery.sh --aggressive  # Hard reset to origin
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

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_step() {
  echo -e "\n${BLUE}→ $1${NC}"
}

AGGRESSIVE=false
if [ "$1" = "--aggressive" ]; then
  AGGRESSIVE=true
  print_warning "AGGRESSIVE MODE: Will force reset to origin branch"
  echo ""
  read -p "Are you sure? This will discard all local changes. (yes/no): " -r
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
  fi
  echo ""
fi

# Find repo root
INSTALL_DIR="${INSTALL_DIR:-$HOME/selva}"
if [ ! -d "$INSTALL_DIR/.git" ]; then
  print_error "Not a git repository: $INSTALL_DIR"
  exit 1
fi

cd "$INSTALL_DIR"

print_header "Selva Git Recovery"

# Get current state
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
print_success "Current branch: $CURRENT_BRANCH"

################################################################################
# 1. DETECT ISSUES
################################################################################
print_header "Detecting Issues"

ISSUES_FOUND=false

# Check for merge in progress
if [ -f ".git/MERGE_HEAD" ]; then
  print_warning "✗ Merge in progress"
  ISSUES_FOUND=true
fi

# Check for rebase in progress
if [ -f ".git/rebase-merge/applying" ] || [ -f ".git/rebase-apply/applying" ]; then
  print_warning "✗ Rebase/am in progress"
  ISSUES_FOUND=true
fi

# Check for unresolved conflicts
if git diff --name-only --diff-filter=U 2>/dev/null | grep -q .; then
  print_warning "✗ Unresolved merge conflicts"
  ISSUES_FOUND=true
fi

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  print_warning "✗ Uncommitted changes detected"
  ISSUES_FOUND=true
fi

# Check for untracked files
if git ls-files --others --exclude-standard | grep -q .; then
  print_warning "✗ Untracked files present"
  ISSUES_FOUND=true
fi

if [ "$ISSUES_FOUND" = false ]; then
  print_success "No issues detected — repository is clean!"
  exit 0
fi

################################################################################
# 2. RECOVER
################################################################################
print_header "Recovery Steps"

# Untrack local-only files that should never be synced
print_step "Untracking local-only files..."
git rm --cached -r -f "packages/compute-app/example-definitions/definitions-config.json" 2>/dev/null || true
git rm --cached -r -f "packages/compute-app/definitions" 2>/dev/null || true
print_success "Local-only files protected from sync"

# Cancel any pending merge/rebase
if [ -f ".git/MERGE_HEAD" ] || [ -f ".git/rebase-merge/applying" ] || [ -f ".git/rebase-apply/applying" ]; then
  print_step "Cancelling pending merge/rebase..."
  git merge --abort 2>/dev/null || true
  git rebase --abort 2>/dev/null || true
  print_success "Pending operations cancelled"
fi

# Handle local changes
if [ "$AGGRESSIVE" = true ]; then
  print_step "Hard resetting to origin/$CURRENT_BRANCH..."
  git fetch origin
  git reset --hard "origin/$CURRENT_BRANCH"
  print_success "Reset to origin/$CURRENT_BRANCH"
else
  # Safe mode: stash and clean
  print_step "Stashing local changes..."
  git stash push -m "git-recovery.sh auto-stash $(date +%Y-%m-%d_%H:%M:%S)"
  print_success "Changes stashed (retrieve with: git stash list)"

  print_step "Cleaning untracked files..."
  git clean -fd
  print_success "Untracked files removed"
fi

################################################################################
# 3. VERIFY
################################################################################
print_header "Verification"

if git diff --quiet && git diff --cached --quiet; then
  print_success "Working directory is clean"
else
  print_warning "Still has uncommitted changes"
  git status --short
fi

if ! git diff --name-only --diff-filter=U 2>/dev/null | grep -q .; then
  print_success "No unresolved conflicts"
else
  print_warning "Conflicts remain"
fi

################################################################################
# COMPLETION
################################################################################
print_header "Recovery Complete"

echo -e "${GREEN}Repository is ready for updates.${NC}"
echo ""
echo "Next steps:"
echo "  1. Review git status:"
echo "     git status"
echo ""
echo "  2. Re-run the update script:"
echo "     bash $INSTALL_DIR/scripts/update.sh"
echo ""

if [ "$AGGRESSIVE" = false ] && git stash list | grep -q git-recovery; then
  echo "  3. To restore any stashed changes later:"
  echo "     git stash pop"
  echo ""
fi

print_success "Done!"
