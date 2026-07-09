-- 001_evidence_schema.sql
-- V2 Evidence Pipeline — Postgres DDL
-- All tables, constraints, indexes, timestamps.
-- Applied via: psql or migration runner.

-- ── Extensions ─────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Evidence Packages ──────────────────────────────────────────────────────

CREATE TABLE evidence_packages (
  id               TEXT PRIMARY KEY,
  capture_id       TEXT NOT NULL UNIQUE,
  manifest_id      TEXT,
  url              TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'received'
                     CHECK (status IN ('received','processing','completed','degraded','failed')),
  schema_version   TEXT NOT NULL DEFAULT '2.0.0',
  metadata         JSONB,
  minio_bucket     TEXT,
  minio_package_key   TEXT,
  minio_screenshot_key TEXT,
  package_hash     TEXT,
  integrity_verified  BOOLEAN DEFAULT FALSE,
  captured_at      TIMESTAMPTZ NOT NULL,
  processing_completed_at TIMESTAMPTZ,
  signal_gaps      JSONB DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_capture_id ON evidence_packages(capture_id);
CREATE INDEX idx_evidence_status      ON evidence_packages(status);
CREATE INDEX idx_evidence_captured_at ON evidence_packages(captured_at DESC);
CREATE INDEX idx_evidence_url         ON evidence_packages(url);

-- ── Signals ────────────────────────────────────────────────────────────────

CREATE TABLE signals (
  id                   TEXT PRIMARY KEY,
  evidence_package_id  TEXT NOT NULL REFERENCES evidence_packages(id) ON DELETE CASCADE,
  signal               TEXT NOT NULL,
  severity             TEXT NOT NULL CHECK (severity IN ('required','strong','medium','low')),
  status               TEXT NOT NULL CHECK (status IN ('present','absent','error')),
  confidence           REAL,
  node_count           INTEGER DEFAULT 0,
  capture_evidence_path TEXT,
  extractor_version    TEXT,
  error                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_signals_evidence_id ON signals(evidence_package_id);
CREATE INDEX idx_signals_signal      ON signals(signal);

-- ── Nodes ──────────────────────────────────────────────────────────────────

CREATE TABLE nodes (
  id                    TEXT PRIMARY KEY,
  evidence_package_id   TEXT NOT NULL REFERENCES evidence_packages(id) ON DELETE CASCADE,
  node_id               TEXT NOT NULL,
  parent_node_id        TEXT,
  tag                   TEXT NOT NULL,
  class_list            JSONB DEFAULT '[]'::jsonb,
  attributes            JSONB DEFAULT '{}'::jsonb,
  rect                  JSONB DEFAULT '{}'::jsonb,
  text_content          TEXT,
  computed_styles       JSONB DEFAULT '{}'::jsonb,
  antd_class_matches    JSONB,
  antd_tokens           JSONB,
  fiber_identity        JSONB DEFAULT '{}'::jsonb,
  a11y_properties       JSONB DEFAULT '{}'::jsonb,
  drift_score           REAL,
  drift_classification  TEXT,
  visual_hash           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nodes_evidence_id      ON nodes(evidence_package_id);
CREATE INDEX idx_nodes_tag              ON nodes(tag);
CREATE INDEX idx_nodes_visual_hash      ON nodes(visual_hash) WHERE visual_hash IS NOT NULL;

-- ── Clusters ───────────────────────────────────────────────────────────────

CREATE TABLE clusters (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  evidence_package_ids   JSONB DEFAULT '[]'::jsonb,
  member_node_ids        JSONB DEFAULT '[]'::jsonb,
  usage_count            INTEGER NOT NULL DEFAULT 0,
  drift_classification   TEXT,
  drift_score            REAL,
  drifted_properties     JSONB DEFAULT '[]'::jsonb,
  priority_score         REAL,
  confidence_distribution JSONB,
  approval_status        TEXT NOT NULL DEFAULT 'pending'
                            CHECK (approval_status IN ('pending','approved','rejected','deferred')),
  approval_note          TEXT,
  screens                JSONB DEFAULT '[]'::jsonb,
  fingerprint            JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clusters_approval_status       ON clusters(approval_status);
CREATE INDEX idx_clusters_drift_classification  ON clusters(drift_classification);
CREATE INDEX idx_clusters_priority_score        ON clusters(priority_score DESC);
CREATE INDEX idx_clusters_name                  ON clusters(name);

-- ── Releases ───────────────────────────────────────────────────────────────

CREATE TABLE releases (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  version               TEXT NOT NULL UNIQUE,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','reviewing','approved','published','superseded')),
  included_evidence_ids JSONB DEFAULT '[]'::jsonb,
  token_overrides       JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at          TIMESTAMPTZ,
  is_published          BOOLEAN NOT NULL DEFAULT FALSE,
  figma_file_id         TEXT,
  figma_clone_id        TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_releases_status    ON releases(status);
CREATE INDEX idx_releases_version   ON releases(version);

-- ── Release ↔ Cluster join ─────────────────────────────────────────────────

CREATE TABLE release_clusters (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  release_id        TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  cluster_id        TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  approval_status   TEXT NOT NULL DEFAULT 'pending'
                       CHECK (approval_status IN ('pending','approved','rejected','deferred')),
  override_outcome  TEXT
                       CHECK (override_outcome IS NULL OR
                              override_outcome IN ('normalize-to-keep','keep-approved-override','promote-to-custom','reject')),
  override_details  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (release_id, cluster_id)
);

CREATE INDEX idx_release_clusters_release_id ON release_clusters(release_id);
CREATE INDEX idx_release_clusters_cluster_id ON release_clusters(cluster_id);

-- ── Tokens ─────────────────────────────────────────────────────────────────

CREATE TABLE tokens (
  token_name          TEXT PRIMARY KEY,
  canonical_value     TEXT NOT NULL,
  antd_default_value  TEXT,
  data_type           TEXT DEFAULT 'string',
  variant_count       INTEGER DEFAULT 1,
  variants            JSONB DEFAULT '[]'::jsonb,
  usage_across_screens JSONB DEFAULT '[]'::jsonb,
  usage_count         INTEGER DEFAULT 0,
  drift_status        TEXT
                         CHECK (drift_status IS NULL OR
                                drift_status IN ('aligned','drifted','variant-collision')),
  drift_detail        TEXT,
  last_evidence_id    TEXT,
  last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tokens_drift_status ON tokens(drift_status);

-- ── Figma Publish Log ──────────────────────────────────────────────────────

CREATE TABLE figma_logs (
  id              TEXT PRIMARY KEY,
  release_id      TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'published'
                     CHECK (status IN ('published','failed','rolled-back')),
  file_id         TEXT,
  clone_id        TEXT,
  token_count     INTEGER DEFAULT 0,
  cluster_count   INTEGER DEFAULT 0,
  error           TEXT,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_figma_logs_release_id ON figma_logs(release_id);

-- ── OIDC Users ─────────────────────────────────────────────────────────────

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  sub         TEXT NOT NULL UNIQUE,
  email       TEXT,
  name        TEXT,
  roles       JSONB DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login  TIMESTAMPTZ
);

CREATE INDEX idx_users_sub ON users(sub);

-- ── Upload Tokens (idempotency / session) ──────────────────────────────────

CREATE TABLE upload_tokens (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  token_hash  TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_upload_tokens_token_hash ON upload_tokens(token_hash);
CREATE INDEX idx_upload_tokens_session_id ON upload_tokens(session_id);

-- ── Updated-at trigger helper ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_evidence_updated_at
  BEFORE UPDATE ON evidence_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_clusters_updated_at
  BEFORE UPDATE ON clusters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_releases_updated_at
  BEFORE UPDATE ON releases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();