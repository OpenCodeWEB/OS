#!/usr/bin/env bash
set -euo pipefail

# ─── deploy.sh — Cross-platform deploy for OpenCodeABs/UX ───────────────
#
# Usage:
#   ./scripts/deploy.sh              # build + deploy to production
#   ./scripts/deploy.sh --preview    # build + deploy to preview
#   ./scripts/deploy.sh --no-build   # deploy existing dist/ to production
#
# Requires: node, npm, npx (wrangler), git
# ────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse args
BUILD=true
PREVIEW=false
BRANCH="main"

while [[ $# -gt 0 ]]; do
  case $1 in
    --preview) PREVIEW=true; shift ;;
    --no-build) BUILD=false; shift ;;
    --branch) BRANCH="$2"; shift 2 ;;
    *) log_error "Unknown arg: $1"; exit 1 ;;
  esac
done

# ─── Checks ───────────────────────────────────────────────────────────

check_deps() {
  for cmd in node npm git npx; do
    if ! command -v "$cmd" &>/dev/null; then
      log_error "Missing dependency: $cmd"
      exit 1
    fi
  done
  log_ok "All dependencies found"
}

# ─── Build ────────────────────────────────────────────────────────────

do_build() {
  log_info "Building project..."
  npm ci
  npm run build
  log_ok "Build complete (dist/)"
}

# ─── Deploy ───────────────────────────────────────────────────────────

do_deploy() {
  local deploy_args=("--branch=$BRANCH" "--skip-caching")

  if $PREVIEW; then
    log_info "Deploying to PREVIEW..."
  else
    log_info "Deploying to PRODUCTION (branch=$BRANCH)..."
  fi

  npx wrangler pages deploy "${deploy_args[@]}" dist

  if $PREVIEW; then
    local preview_url
    preview_url=$(npx wrangler pages deployment list --project-name pocwu 2>/dev/null | grep "Preview" | head -1 | awk '{print $2}')
    log_ok "Preview URL: $preview_url"
  else
    log_ok "Production URL: https://pocwu.pages.dev"
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "======================================="
  echo "  OpenCodeABs/UX — Deploy Script"
  echo "======================================="
  echo ""

  check_deps

  if $BUILD; then
    do_build
  fi

  do_deploy

  echo ""
  log_ok "Deploy complete!"
  echo ""
}

main
