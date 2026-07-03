# ============================================================
# Makefile — Reverse Design System Pipeline
# ============================================================
# Targets: install build run test dev backup restore clean
# ============================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help

CONFIG_PATH ?= ./config
COMPOSE_FILE := -f docker-compose.yml
COMPOSE_DEV_FILE := -f docker-compose.yml -f docker-compose.dev.yml

# Colours for help output
BLUE := \033[36m
RESET := \033[0m

.PHONY: help install build run test dev backup restore clean

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(BLUE)%-15s$(RESET) %s\n", $$1, $$2}'

# ---- Install ----

install: ## Install all dependencies (production + dev)
	@echo "==> Installing dependencies..."
	cd ../backend && npm ci
	cd ../web-ui && npm ci
	@echo "==> Installing Playwright Chromium (for local dev without Docker)..."
	cd ../backend && npx playwright install chromium
	@echo "==> Done. Dependencies installed."

install-prod: ## Install only production dependencies
	@echo "==> Installing production dependencies..."
	cd ../backend && npm ci --omit=dev
	cd ../web-ui && npm ci --omit=dev
	@echo "==> Done."

# ---- Build ----

build: ## Build all Docker images
	@echo "==> Building Docker images..."
	docker compose $(COMPOSE_FILE) build
	@echo "==> Build complete."

build-api: ## Build only the API image
	@echo "==> Building API image..."
	docker compose $(COMPOSE_FILE) build api
	@echo "==> API build complete."

build-crawler: ## Build only the Crawler image
	@echo "==> Building Crawler image..."
	docker compose $(COMPOSE_FILE) build crawler
	@echo "==> Crawler build complete."

# ---- Run ----

run: ## Start all services in production mode
	@echo "==> Starting Reverse Design System Pipeline..."
	docker compose $(COMPOSE_FILE) up -d
	@echo "==> Pipeline started. Check status: docker compose ps"

run-logs: ## Tail logs from all services
	docker compose $(COMPOSE_FILE) logs -f

run-logs-api: ## Tail API logs only
	docker compose $(COMPOSE_FILE) logs -f api

run-logs-crawler: ## Tail Crawler logs only
	docker compose $(COMPOSE_FILE) logs -f crawler

stop: ## Stop all services
	@echo "==> Stopping all services..."
	docker compose $(COMPOSE_FILE) down
	@echo "==> Services stopped."

restart: stop run ## Restart all services

# ---- Development ----

dev: ## Start all services in development mode (with hot reload)
	@echo "==> Starting Reverse Design System Pipeline (development mode)..."
	docker compose $(COMPOSE_DEV_FILE) --profile dev up -d
	@echo "==> Development mode started."
	@echo "    API:      http://localhost:3000"
	@echo "    Web UI:   http://localhost:5173 (Vite dev server)"

dev-build: ## Rebuild and start in development mode
	docker compose $(COMPOSE_DEV_FILE) --profile dev build
	$(MAKE) dev

# ---- Test ----

test: ## Run all tests
	@echo "==> Running backend tests..."
	cd ../backend && npm test
	@echo "==> Running Web UI tests..."
	cd ../web-ui && npm test
	@echo "==> All tests passed."

test-backend: ## Run only backend tests
	cd ../backend && npm test

test-web-ui: ## Run only Web UI tests
	cd ../web-ui && npm test

# ---- Audit / Security ----

audit: ## Run security audit on all packages
	@echo "==> Running npm audit..."
	cd ../backend && npm audit || true
	cd ../web-ui && npm audit || true

audit-fix: ## Fix security vulnerabilities
	cd ../backend && npm audit fix || true
	cd ../web-ui && npm audit fix || true

# ---- Backup ----

BACKUP_DIR := ./backups
BACKUP_DATE := $(shell date +%Y%m%d_%H%M%S)

backup: ## Backup Docker volumes (db-data + config-data)
	@echo "==> Backing up volumes to $(BACKUP_DIR)/$(BACKUP_DATE)/..."
	@mkdir -p $(BACKUP_DIR)/$(BACKUP_DATE)
	docker run --rm \
		-v reverse-ds-db-data:/source/db \
		-v reverse-ds-config-data:/source/config \
		-v $(CURDIR)/$(BACKUP_DIR)/$(BACKUP_DATE):/backup \
		busybox sh -c "cp -r /source/db /backup/db && cp -r /source/config /backup/config"
	@echo "==> Backup complete: $(BACKUP_DIR)/$(BACKUP_DATE)/"

backup-all: ## Backup all volumes (db-data + config-data + evidence-store)
	@echo "==> Backing up all volumes..."
	@mkdir -p $(BACKUP_DIR)/$(BACKUP_DATE)
	docker run --rm \
		-v reverse-ds-evidence-store:/source/evidence \
		-v reverse-ds-db-data:/source/db \
		-v reverse-ds-config-data:/source/config \
		-v $(CURDIR)/$(BACKUP_DIR)/$(BACKUP_DATE):/backup \
		busybox sh -c "cp -r /source/evidence /backup/evidence && cp -r /source/db /backup/db && cp -r /source/config /backup/config"
	@echo "==> Full backup complete: $(BACKUP_DIR)/$(BACKUP_DATE)/"

restore: ## Restore volumes from a backup (usage: make restore BACKUP=backups/YYYYMMDD_HHMMSS)
	@if [ -z "$(BACKUP)" ]; then \
		echo "ERROR: Specify BACKUP=backups/YYYYMMDD_HHMMSS"; \
		exit 1; \
	fi
	@echo "==> Restoring from $(BACKUP)..."
	docker run --rm \
		-v reverse-ds-db-data:/target/db \
		-v reverse-ds-config-data:/target/config \
		-v $(CURDIR)/$(BACKUP):/backup \
		busybox sh -c "cp -r /backup/db/* /target/db/ 2>/dev/null; cp -r /backup/config/* /target/config/ 2>/dev/null"
	@echo "==> Restore complete. Restart services: make restart"

# ---- Clean ----

clean: ## Stop all services and remove volumes (WARNING: destroys data!)
	@echo "==> WARNING: This will destroy all data in Docker volumes!"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		echo ""; \
		echo "==> Stopping and cleaning..."; \
		docker compose $(COMPOSE_FILE) down -v; \
		echo "==> Clean complete."; \
	else \
		echo ""; \
		echo "==> Aborted."; \
	fi

clean-images: ## Remove built Docker images
	docker rmi reverse-ds-pipeline-api reverse-ds-pipeline-crawler 2>/dev/null || true
	@echo "==> Images removed."

clean-all: clean clean-images ## Full cleanup: volumes + images
	@echo "==> Full cleanup complete."

# ---- Status ----

ps: ## Show running services status
	docker compose $(COMPOSE_FILE) ps

health: ## Check API health
	@curl -s http://localhost:3000/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:3000/health

# ---- Air-Gapped Export/Import ----

export-images: ## Export Docker images as TAR files for air-gapped transfer
	docker save reverse-ds-pipeline-api:latest -o $(BACKUP_DIR)/reverse-ds-api.tar
	docker save reverse-ds-pipeline-crawler:latest -o $(BACKUP_DIR)/reverse-ds-crawler.tar
	@echo "==> Images exported to $(BACKUP_DIR)/"

import-images: ## Import Docker images from TAR files
	docker load -i $(BACKUP_DIR)/reverse-ds-api.tar
	docker load -i $(BACKUP_DIR)/reverse-ds-crawler.tar
	@echo "==> Images imported."