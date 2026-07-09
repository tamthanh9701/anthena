/**
 * Capture Button V2 — shows active manifest info and captures.
 *
 * @typedef {import('../shared/schema.js').ScenarioManifest} ScenarioManifest
 */

import React, { useState } from 'react';

/** @param {{
 *   sessionState: any,
 *   onCapture: (routeKey: string) => void,
 *   disabled: boolean,
 *   capturing: boolean,
 *   activeManifest: ScenarioManifest|null
 * }} props */
export default function CaptureButton({ sessionState, onCapture, disabled, capturing, activeManifest }) {
  const [routeKey, setRouteKey] = useState('');

  const handleCapture = () => {
    // Derive routeKey from manifest, or use manual input
    const key = routeKey.trim() || (activeManifest
      ? `${activeManifest.route.replace(/^\//, '').replace(/\//g, '-')}-${activeManifest.role}-${activeManifest.theme}`
      : `route-${Date.now()}`);
    onCapture(key);
    setRouteKey('');
  };

  return (
    <div style={{ marginBottom: 12, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
      <h2 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#595959' }}>Capture</h2>

      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'block', fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>
          Route Key (optional; auto from page or manifest if blank)
        </label>
        <input
          type="text"
          value={routeKey}
          onChange={(e) => setRouteKey(e.target.value)}
          placeholder={activeManifest ? `${activeManifest.route}_${activeManifest.role}_${activeManifest.theme}` : 'orders-create'}
          style={{
            width: '100%',
            padding: '4px 8px',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            fontSize: 12,
            boxSizing: 'border-box',
            outline: 'none',
          }}
          disabled={disabled || capturing}
        />
      </div>

      <button
        onClick={handleCapture}
        disabled={disabled || capturing}
        style={{
          width: '100%',
          padding: '10px 16px',
          background: disabled ? '#d9d9d9' : capturing ? '#faad14' : '#1677ff',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 14,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        {capturing ? (
          <>
            <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
            Capturing...
          </>
        ) : (
          <>
            <span>📸</span>
            {activeManifest ? 'Capture Current Scenario' : 'Quick Capture Current Page'}
          </>
        )}
      </button>
    </div>
  );
}
