-- 002_seed_dev_data.sql
-- V2 Evidence Pipeline — Development Seed Data
-- Inserts demo scenario manifest, test user, and placeholder release lifecycle states.
-- Applied via: psql -d anthena_v2 -f 002_seed_dev_data.sql

-- ── Demo scenario manifest (used by extension fixture) ──────────────────────

INSERT INTO evidence_packages (id, capture_id, url, status, schema_version, metadata, captured_at, created_at)
VALUES (
  'ev-demo-001',
  'cap-demo-dashboard',
  'https://staging.example.com/dashboard',
  'completed',
  '2.0.0',
  '{"scenario":{"manifestId":"mft-demo-001","route":"/dashboard","role":"admin","theme":"light","locale":"en-US"},"viewport":{"width":1440,"height":900}}',
  NOW(),
  NOW()
);

-- ── Demo admin user ─────────────────────────────────────────────────────────

INSERT INTO users (id, sub, email, name, roles)
VALUES (
  'usr-demo-admin-001',
  'sub-demo-admin',
  'admin@anthena.dev',
  'Demo Admin',
  '["admin","operator","reviewer"]'
);

-- ── Demo release lifecycle states ──────────────────────────────────────────

INSERT INTO releases (id, name, version, status, description, created_at, published_at, is_published)
VALUES
  ('rel-demo-draft-001', 'Demo Draft', 'v0.1.0', 'draft', 'Demo release in draft state', NOW(), NULL, FALSE),
  ('rel-demo-published-001', 'Demo Published', 'v0.0.1', 'published', 'Initial baseline release', NOW() - INTERVAL '1 day', NOW(), TRUE);

-- ── Demo tokens (baseline Ant Design v5 defaults) ──────────────────────────

INSERT INTO tokens (token_name, canonical_value, antd_default_value, data_type, variant_count, usage_count, drift_status, created_at)
VALUES
  ('colorPrimary', '#1677ff', '#1677ff', 'color', 1, 0, 'aligned', NOW()),
  ('borderRadius', '6px', '6px', 'dimension', 1, 0, 'aligned', NOW()),
  ('colorError', '#ff4d4f', '#ff4d4f', 'color', 1, 0, 'aligned', NOW()),
  ('colorSuccess', '#52c41a', '#52c41a', 'color', 1, 0, 'aligned', NOW()),
  ('fontSize', '14px', '14px', 'dimension', 1, 0, 'aligned', NOW());

-- ── Demo clusters ──────────────────────────────────────────────────────────

INSERT INTO clusters (id, name, evidence_package_ids, member_node_ids, usage_count, drift_classification, drift_score, approval_status, screens, created_at)
VALUES
  ('clust-demo-btn-001', 'ant-btn-primary', '["ev-demo-001"]', '["n-demo-001"]', 3, 'antd-aligned', 0, 'approved',
   '[{"url":"https://staging.example.com/dashboard","role":"admin","evidencePackageId":"ev-demo-001"}]', NOW()),
  ('clust-demo-input-001', 'ant-input', '["ev-demo-001"]', '["n-demo-002"]', 5, 'antd-aligned', 0, 'pending',
   '[{"url":"https://staging.example.com/dashboard","role":"admin","evidencePackageId":"ev-demo-001"}]', NOW()),
  ('clust-demo-header-001', 'ant-custom-header', '["ev-demo-001"]', '["n-demo-003"]', 1, 'drifted', 0.4, 'pending',
   '[{"url":"https://staging.example.com/dashboard","role":"admin","evidencePackageId":"ev-demo-001"}]', NOW());