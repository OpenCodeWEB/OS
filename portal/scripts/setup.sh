#!/usr/bin/env bash
set -euo pipefail

# ─── setup.sh — Dev environment setup for OpenCodeABs/UX ──────────────
#
# Usage:
#   ./scripts/setup.sh              # full setup (npm + wrangler login)
#   ./scripts/setup.sh --quick      # npm install only
#   ./scripts/setup.sh --rust       # also setup Rust WASM toolchain
#   ./scripts/setup.sh --python     # also setup Python venv
#
# ────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SETUP_RUST=false
SETUP_PYTHON=false
QUICK=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --rust)    SETUP_RUST=true; shift ;;
    --python)  SETUP_PYTHON=true; shift ;;
    --quick)   QUICK=true; shift ;;
    *) log_error "Unknown arg: $1"; exit 1 ;;
  esac
done

# ─── Node.js ──────────────────────────────────────────────────────────

setup_node() {
  log_info "Installing npm dependencies..."
  npm ci
  log_ok "npm dependencies installed"
}

# ─── Wrangler ─────────────────────────────────────────────────────────

setup_wrangler() {
  if $QUICK; then
    return
  fi
  log_info "Checking Cloudflare Wrangler authentication..."
  if npx wrangler whoami &>/dev/null; then
    log_ok "Wrangler authenticated"
  else
    log_warn "Run 'npx wrangler login' to authenticate with Cloudflare"
  fi
}

# ─── Rust / WASM ──────────────────────────────────────────────────────

setup_rust() {
  if ! command -v rustc &>/dev/null; then
    log_warn "Rust not installed. Visit https://rustup.rs/"
    return
  fi
  log_info "Rust toolchain found: $(rustc --version)"

  if ! command -v wasm-pack &>/dev/null; then
    log_info "Installing wasm-pack..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
  fi
  log_ok "wasm-pack ready"

  log_info "Building WASM globe physics module..."
  (cd rswasm-globe-physics && cargo check --target wasm32-unknown-unknown 2>/dev/null && log_ok "WASM target OK") || log_warn "wasm32 target not installed — run: rustup target add wasm32-unknown-unknown"
}

# ─── Python ───────────────────────────────────────────────────────────

setup_python() {
  if ! command -v python3 &>/dev/null; then
    log_warn "Python 3 not found"
    return
  fi
  log_info "Python found: $(python3 --version)"

  if [ ! -d ".venv" ]; then
    log_info "Creating Python virtual environment..."
    python3 -m venv .venv
  fi
  source .venv/bin/activate 2>/dev/null || true
  pip install -q -r scripts/requirements.txt 2>/dev/null && log_ok "Python deps installed" || log_warn "Could not install Python deps"
}

# ─── Main ─────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "======================================="
  echo "  OpenCodeABs/UX — Setup"
  echo "======================================="
  echo ""

  setup_node
  setup_wrangler

  if $SETUP_RUST; then
    setup_rust
  fi
  if $SETUP_PYTHON; then
    setup_python
  fi

  echo ""
  log_ok "Setup complete!"
  echo ""
}

main
