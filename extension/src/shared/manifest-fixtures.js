/**
 * Scenario Manifest Fixture Loader
 * Provides default manifests and validation for V2 capture sessions.
 * Fixtures ship with the extension; runtime lets user create/edit.
 * @typedef {import('../shared/schema.js').ScenarioManifest} ScenarioManifest
 */

// ─── Built-in Fixture Manifests ─────────────────────────────

/** @type {ScenarioManifest[]} */
const BUILT_IN_MANIFESTS = [
  {
    id: 'manifest-admin-light-en-default',
    name: 'Admin Dashboard — Light EN',
    route: '/dashboard',
    role: 'admin',
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    locale: 'en-US',
    actions: ['search', 'sort', 'filter', 'create', 'edit', 'delete'],
    states: ['loading', 'empty', 'error', 'success'],
    tags: ['critical', 'public-facing'],
  },
  {
    id: 'manifest-user-list-admin',
    name: 'User List — Admin — Light',
    route: '/users/list',
    role: 'admin',
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    locale: 'en-US',
    actions: ['search', 'sort', 'filter', 'create', 'edit', 'delete', 'bulk-delete'],
    states: ['loading', 'empty', 'error', 'success', 'partial'],
    tags: ['critical'],
  },
  {
    id: 'manifest-user-create-operator',
    name: 'User Create — Operator',
    route: '/users/create',
    role: 'operator',
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    locale: 'en-US',
    actions: ['create', 'save', 'reset'],
    states: ['loading', 'error', 'success', 'validation-error'],
    tags: ['new', 'form'],
  },
  {
    id: 'manifest-settings-viewer',
    name: 'Settings — Viewer',
    route: '/settings',
    role: 'viewer',
    viewport: { width: 1440, height: 900 },
    theme: 'light',
    locale: 'en-US',
    actions: ['view', 'refresh'],
    states: ['loading', 'error', 'success'],
    tags: [],
  },
];

// ─── Storage Keys ───────────────────────────────────────────

const STORAGE_KEY = 'anthena_v2_manifests';
const ACTIVE_MANIFEST_KEY = 'anthena_v2_active_manifest_id';

// ─── Load & Save ────────────────────────────────────────────

/**
 * Get all manifests (built-in + user-created). Initializes with built-ins on first load.
 * @returns {Promise<ScenarioManifest[]>}
 */
export async function loadManifests() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const stored = result[STORAGE_KEY];
      if (stored && Array.isArray(stored) && stored.length > 0) {
        resolve(stored);
      } else {
        // Seed with built-in fixtures
        const withTimestamps = BUILT_IN_MANIFESTS.map((m) => ({
          ...m,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        chrome.storage.local.set({ [STORAGE_KEY]: withTimestamps }, () => {
          resolve(withTimestamps);
        });
      }
    });
  });
}

/**
 * Save manifests to storage.
 * @param {ScenarioManifest[]} manifests
 */
export function saveManifests(manifests) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: manifests }, resolve);
  });
}

/**
 * Create a new manifest.
 * @param {Omit<ScenarioManifest, 'createdAt'|'updatedAt'>} manifest
 * @returns {Promise<ScenarioManifest>}
 */
export async function createManifest(manifest) {
  const manifests = await loadManifests();
  const now = new Date().toISOString();
  const newManifest = { ...manifest, createdAt: now, updatedAt: now };
  manifests.push(newManifest);
  await saveManifests(manifests);
  return newManifest;
}

/**
 * Update an existing manifest.
 * @param {string} id
 * @param {Partial<ScenarioManifest>} updates
 */
export async function updateManifest(id, updates) {
  const manifests = await loadManifests();
  const idx = manifests.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(`Manifest not found: ${id}`);
  manifests[idx] = { ...manifests[idx], ...updates, updatedAt: new Date().toISOString() };
  await saveManifests(manifests);
  return manifests[idx];
}

/**
 * Delete a manifest.
 * @param {string} id
 */
export async function deleteManifest(id) {
  const manifests = await loadManifests();
  const filtered = manifests.filter((m) => m.id !== id);
  await saveManifests(filtered);
}

/**
 * Get the currently active manifest ID from storage.
 * @returns {Promise<string|null>}
 */
export function getActiveManifestId() {
  return new Promise((resolve) => {
    chrome.storage.local.get([ACTIVE_MANIFEST_KEY], (result) => {
      resolve(result[ACTIVE_MANIFEST_KEY] || null);
    });
  });
}

/**
 * Set the active manifest ID.
 * @param {string} manifestId
 */
export function setActiveManifestId(manifestId) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [ACTIVE_MANIFEST_KEY]: manifestId }, resolve);
  });
}

/**
 * Get the full active manifest object.
 * @returns {Promise<ScenarioManifest|null>}
 */
export async function getActiveManifest() {
  const id = await getActiveManifestId();
  if (!id) return null;
  const manifests = await loadManifests();
  return manifests.find((m) => m.id === id) || null;
}

/**
 * Derive a routeKey from a manifest.
 * @param {ScenarioManifest} manifest
 * @returns {string}
 */
export function manifestToRouteKey(manifest) {
  const parts = [
    manifest.route.replace(/^\//, '').replace(/\//g, '-'),
    manifest.role,
    manifest.theme,
    manifest.locale,
  ];
  return parts.filter(Boolean).join('-');
}

/**
 * Validate a manifest object.
 * @param {Partial<ScenarioManifest>} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest.name || typeof manifest.name !== 'string') errors.push('name is required');
  if (!manifest.route || typeof manifest.route !== 'string') errors.push('route is required');
  if (!manifest.role || !['admin', 'operator', 'viewer', 'public'].includes(manifest.role)) {
    errors.push('role must be one of: admin, operator, viewer, public');
  }
  if (!manifest.viewport || typeof manifest.viewport.width !== 'number' || typeof manifest.viewport.height !== 'number') {
    errors.push('viewport must have width and height');
  }
  if (manifest.theme && !['light', 'dark'].includes(manifest.theme)) {
    errors.push('theme must be light or dark');
  }
  return { valid: errors.length === 0, errors };
}

export { BUILT_IN_MANIFESTS };