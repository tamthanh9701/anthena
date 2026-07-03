import React, { useState } from 'react';

const DEFAULT_API_BASE_URL = 'https://anthena.example.com';
const DEFAULT_ADMIN_TOKEN = 'dev-token-anthena-2026';
const DEFAULT_MODULE = 'orders';
const DEFAULT_ENV = 'staging';

export default function RunSelector({ sessionState, onConfigure, disabled }) {
  const [apiBaseUrl, setApiBaseUrl] = useState(sessionState.apiBaseUrl || DEFAULT_API_BASE_URL);
  const [adminToken, setAdminToken] = useState(sessionState.adminToken || DEFAULT_ADMIN_TOKEN);
  const [runId, setRunId] = useState(sessionState.runId || '');
  const [moduleName, setModuleName] = useState(DEFAULT_MODULE);
  const [environment, setEnvironment] = useState(DEFAULT_ENV);

  const handleConnect = () => {
    if (!runId.trim()) return;
    onConfigure({ apiBaseUrl, adminToken, runId: runId.trim(), moduleName, environment });
  };

  return (
    <div style={{ marginBottom: 12, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
      <h2 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#595959' }}>Session Config</h2>

      <div style={{ marginBottom: 6 }}>
        <label style={{ display: 'block', fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>API Base URL</label>
        <input
          type="text"
          value={apiBaseUrl}
          onChange={e => setApiBaseUrl(e.target.value)}
          style={inputStyle}
          disabled={disabled}
        />
      </div>

      <div style={{ marginBottom: 6 }}>
        <label style={{ display: 'block', fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>Run ID</label>
        <input
          type="text"
          value={runId}
          onChange={e => setRunId(e.target.value)}
          placeholder="run-27cd7524"
          style={inputStyle}
          disabled={disabled}
        />
      </div>

      <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>Module</label>
          <input
            type="text"
            value={moduleName}
            onChange={e => setModuleName(e.target.value)}
            style={inputStyle}
            disabled={disabled}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#8c8c8c', marginBottom: 2 }}>Env</label>
          <input
            type="text"
            value={environment}
            onChange={e => setEnvironment(e.target.value)}
            style={inputStyle}
            disabled={disabled}
          />
        </div>
      </div>

      <button
        onClick={handleConnect}
        disabled={disabled || !runId.trim()}
        style={{
          width: '100%',
          padding: '6px 12px',
          background: disabled ? '#d9d9d9' : '#1677ff',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {sessionState.sessionId ? 'Reconnect' : 'Connect Session'}
      </button>

      {sessionState.sessionId && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#52c41a' }}>
          ✓ Session: {sessionState.sessionId.substring(0, 24)}...
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '4px 8px',
  border: '1px solid #d9d9d9',
  borderRadius: 4,
  fontSize: 12,
  boxSizing: 'border-box',
  outline: 'none',
};