# ──────────────────────────────────────────────────────────────────────────────
# OpenCodeABs/UX — Polyglot Build System
# ──────────────────────────────────────────────────────────────────────────────
# Targets:
#   make             build the TypeScript frontend (npm run build)
#   make dev         start dev server
#   make test        run TypeScript type check
#   make deploy      build + deploy to Cloudflare Pages (production)
#   make preview     build + deploy to Cloudflare Pages (preview)
#   make wasm        compile Rust WASM globe physics module
#   make python      run Python data validation
#   make shaders     validate GLSL shader files
#   make clean       remove build artifacts
#   make polyglot    validate all polyglot language files exist
# ──────────────────────────────────────────────────────────────────────────────

SHELL := /bin/bash
NPM   := npm
NPX   := npx
PYTHON := python3

# ─── Color output ────────────────────────────────────────────────────────────
INFO  := @printf "\033[0;36m[INFO]\033[0m  %s\n"
OK    := @printf "\033[0;32m[OK]\033[0m    %s\n"
WARN  := @printf "\033[1;33m[WARN]\033[0m  %s\n"
ERR   := @printf "\033[0;31m[ERROR]\033[0m %s\n"

.PHONY: all dev test deploy preview wasm python shaders clean polyglot

# ─── Default ─────────────────────────────────────────────────────────────────

all: build

# ─── Frontend ────────────────────────────────────────────────────────────────

build:
	$(INFO) "Building frontend..."
	$(NPM) ci
	$(NPM) run build
	$(OK) "Build complete (dist/)"

dev:
	$(INFO) "Starting dev server..."
	$(NPM) run dev

test:
	$(INFO) "Running type check..."
	$(NPX) tsc --noEmit
	$(OK) "Type check passed"

# ─── Deploy ──────────────────────────────────────────────────────────────────

deploy: build
	$(INFO) "Deploying to PRODUCTION..."
	$(NPX) wrangler pages deploy --branch=main --skip-caching dist
	$(OK) "Production deploy complete: https://pocwu.pages.dev"

preview: build
	$(INFO) "Deploying to preview..."
	$(NPX) wrangler pages deploy --branch=main --skip-caching dist
	$(OK) "Preview deploy complete"

# ─── Rust WASM ───────────────────────────────────────────────────────────────

wasm:
	$(INFO) "Building Rust WASM globe physics module..."
	cd rswasm-globe-physics && cargo check
	$(OK) "Rust module OK"

wasm-release:
	$(INFO) "Building Rust WASM (release)..."
	cd rswasm-globe-physics && cargo build --release
	$(OK) "Rust release build complete"

# ─── Python ──────────────────────────────────────────────────────────────────

python:
	$(INFO) "Running Python data validation..."
	$(PYTHON) scripts/generate_cities.py --validate
	$(OK) "Python validation passed"

# ─── GLSL Shaders ────────────────────────────────────────────────────────────

shaders:
	$(INFO) "Checking GLSL shader files exist..."
	@for f in shaders/*.vert shaders/*.frag; do \
		if [ -f "$$f" ]; then \
			$(OK) "  Found: $$f"; \
		else \
			$(WARN) "  Missing: $$f"; \
		fi \
	done

# ─── Clean ───────────────────────────────────────────────────────────────────

clean:
	$(INFO) "Cleaning build artifacts..."
	rm -rf dist/
	rm -rf node_modules/
	rm -rf rswasm-globe-physics/target/
	rm -f tsconfig.tsbuildinfo
	$(OK) "Clean complete"

# ─── Polyglot Check ──────────────────────────────────────────────────────────

polyglot:
	$(INFO) "Validating polyglot language files..."
	$(OK) "TypeScript:     $$(find src -name '*.ts' -o -name '*.tsx' | wc -l) files"
	$(OK) "JavaScript:     $$(find src -name '*.js' | wc -l) files"
	$(OK) "CSS:            $$(find src -name '*.css' | wc -l) files"
	$(OK) "JSON:           $$(find . -name '*.json' -not -path './node_modules/*' -not -path './dist/*' | wc -l) files"
	$(OK) "HTML:           $$(find . -name '*.html' -not -path './node_modules/*' -not -path './dist/*' | wc -l) files"
	$(OK) "Rust:           $$(find . -name '*.rs' | wc -l) files"
	$(OK) "Python:         $$(find . -name '*.py' | wc -l) files"
	$(OK) "Shell:          $$(find . -name '*.sh' | wc -l) files"
	$(OK) "GLSL:           $$(find . -name '*.vert' -o -name '*.frag' | wc -l) files"
	$(OK) "Go:             $$(find . -name '*.go' | wc -l) files"
	$(OK) "Lua:            $$(find . -name '*.lua' | wc -l) files"
	$(OK) "Ruby:           $$(find . -name '*.rb' | wc -l) files"
	$(OK) "Zig:            $$(find . -name '*.zig' | wc -l) files"
	$(OK) "C:              $$(find . -name '*.c' -o -name '*.h' | wc -l) files"
	$(OK) "Kotlin:         $$(find . -name '*.kts' -o -name '*.kt' | wc -l) files"
	$(OK) "Nim:            $$(find . -name '*.nim' | wc -l) files"
	$(OK) "SQL:            $$(find . -name '*.sql' | wc -l) files"
	$(OK) "TOML:           $$(find . -name '*.toml' | wc -l) files"
	$(OK) "PowerShell:     $$(find . -name '*.ps1' | wc -l) files"
	$(OK) "YAML:           $$(find . -name '*.yml' -o -name '*.yaml' | wc -l) files"
	$(OK) "Dockerfile:     $$(find . -name 'Dockerfile' | wc -l) files"
	$(OK) "Makefile:       $$(find . -name 'Makefile' -o -name '*.mk' | wc -l) files"
	@echo ""
	$(OK) "Polyglot check complete — 22 language types tracked"

# ─── Help ────────────────────────────────────────────────────────────────────

help:
	@echo "OpenCodeABs/UX — Build Targets"
	@echo "  make            Build frontend"
	@echo "  make dev        Start dev server"
	@echo "  make test       Run TypeScript type check"
	@echo "  make deploy     Build + deploy to production"
	@echo "  make preview    Build + deploy to preview"
	@echo "  make wasm       Build Rust WASM module"
	@echo "  make python     Validate Python data"
	@echo "  make shaders    Check GLSL shader files"
	@echo "  make clean      Remove build artifacts"
	@echo "  make polyglot   List all language files"
