/**
 * Manifest Selector — Popup component for selecting/capturing with a Scenario Manifest.
 *
 * @typedef {import('../shared/schema.js').ScenarioManifest} ScenarioManifest
 */

import React, { useState } from 'react';

/** @param {{
 *   manifests: ScenarioManifest[],
 *   activeManifest: ScenarioManifest|null,
 *   onManifestChange: (id: string) => void,
 *   disabled: boolean
 * }} props */
export default function ManifestSelector({ manifests, activeManifest, onManifestChange, disabled }) {
  const [showEditor, setShowEditor] = useState(false);
  const [editName, setEditName] = useState(activeManifest?.name || '');

  const handleSelect = (e) => {
    onManifestChange(e.target.value);
  };

  return (
    <div style={{ marginBottom: 12, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#595959' }}>Scenario Manifest</div>
        <button
          onClick={() => setShowEditor(!showEditor)}
          style={{
            background: 'none',
            border: 'none',
            color: '#1677ff',
            cursor: 'pointer',
            fontSize: 12,
            padding: 0,
          }}
        >
          {showEditor ? 'Hide' : activeManifest ? 'Edit' : 'New'}
        </button>
      </div>

      {/* ── Selector ────────────────────────────────────────── */}
      <select
        value={activeManifest?.id || ''}
        onChange={handleSelect}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '6px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: 4,
          fontSize: 12,
          marginBottom: 8,
          boxSizing: 'border-box',
          background: '#fff',
        }}
      >
        <option value="">— No manifest (basic capture) —</option>
        {manifests.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      {/* ── Active Manifest Card ────────────────────────────── */}
      {activeManifest && (
        <div style={{
          padding: 8,
          background: '#f0f5ff',
          borderRadius: 4,
          border: '1px solid #d6e4ff',
          fontSize: 11,
          color: '#595959',
        }}>
          <div><strong>Route:</strong> {activeManifest.route}</div>
          <div><strong>Role:</strong> {activeManifest.role} | <strong>Theme:</strong> {activeManifest.theme}</div>
          <div><strong>Viewport:</strong> {activeManifest.viewport.width}x{activeManifest.viewport.height}</div>
          <div><strong>Locale:</strong> {activeManifest.locale}</div>
          <div><strong>Actions:</strong> {activeManifest.actions.join(', ')}</div>
          <div><strong>States:</strong> {activeManifest.states.join(', ')}</div>
        </div>
      )}

      {/* ── Quick Editor ────────────────────────────────────── */}
      {showEditor && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
          <label style={{ display: 'block', fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>Manifest Name</label>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="User List — Admin — Dark"
            style={{
              width: '100%',
              padding: '4px 8px',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              fontSize: 12,
              boxSizing: 'border-box',
              outline: 'none',
              marginBottom: 4,
            }}
          />
          <div style={{ fontSize: 10, color: '#8c8c8c' }}>
            Full editor available in dashboard.
          </div>
        </div>
      )}
    </div>
  );
}