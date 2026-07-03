#!/bin/bash
# ============================================================
# init.sh — First-Time Setup Script for Reverse DS Pipeline
# ============================================================
# Run this once on ZimaOS after cloning the repository.
# It checks prerequisites, creates config, and starts the stack.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo " Reverse Design System Pipeline — First Setup"
echo "============================================"

# ---- Step 1: Check Docker ----
echo ""
echo "[1/5] Checking Docker installation..."
if ! command -v docker &>/dev/null; then
    echo "ERROR: Docker is not installed. Please install Docker first."
    echo "  ZimaOS: Install via App Store or: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! docker compose version &>/dev/null; then
    echo "ERROR: Docker Compose is not available."
    exit 1
fi
echo "  Docker: $(docker --version)"
echo "  Docker Compose: $(docker compose version)"

# ---- Step 2: Create config directory and .env ----
echo ""
echo "[2/5] Setting up configuration..."

if [ ! -f config/.env ]; then
    if [ ! -d config ]; then
        mkdir -p config
    fi

    if [ -f .env.template ]; then
        cp .env.template config/.env
        chmod 600 config/.env
        echo "  Created config/.env from .env.template"
        echo "  IMPORTANT: Edit config/.env with your credentials before continuing!"
        echo "  Run: nano config/.env"
        echo ""
        read -p "  Edit config/.env now? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Try available editor
            for editor in nano vim vi; do
                if command -v "$editor" &>/dev/null; then
                    "$editor" config/.env
                    break
                fi
            done
        fi
    else
        echo "  WARNING: .env.template not found. Creating empty config/.env"
        touch config/.env
        chmod 600 config/.env
    fi
else
    echo "  config/.env already exists. Skipping."
fi

# ---- Step 3: Create necessary directories ----
echo ""
echo "[3/5] Creating volume mount directories..."

# On ZimaOS, Docker volumes are managed by Docker.
# For bind-mounted config, ensure directory exists.
mkdir -p config
echo "  config/ directory ready."

# ---- Step 4: Build Docker images ----
echo ""
echo "[4/5] Building Docker images..."
echo "  This may take a while (especially the Playwright crawler image ~1.2 GB)..."
docker compose build
echo "  Build complete."

# ---- Step 5: Start the stack ----
echo ""
echo "[5/5] Starting services..."
docker compose up -d
echo ""

# ---- Verify ----
echo "============================================"
echo " Setup Complete!"
echo "============================================"
echo ""
echo " Services:"
docker compose ps
echo ""
echo " Health check:"
sleep 3
curl -s http://localhost:3000/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3000/health
echo ""
echo ""
echo " Access the Web UI at: http://localhost:3000"
echo ""
echo " Useful commands:"
echo "  View logs:     docker compose logs -f"
echo "  Stop:          docker compose down"
echo "  Restart:       docker compose up -d"
echo "  Backup:        make backup"
echo ""
echo " NOTE: If this is your first run, the crawler may take"
echo " up to 30 seconds to register as healthy (Playwright"
echo " browser launch). The health endpoint will initially"
echo " show playwright as 'unavailable'."