import React from 'react';

export default function UploadStatus({ captureId, status, url }) {
  if (!captureId) return null;

  const statusColor = {
    uploaded: '#52c41a',
    pending: '#faad14',
    failed: '#ff4d4f',
    normalized: '#1677ff',
    analyzed: '#722ed1',
  }[status] || '#8c8c8c';

  const statusLabel = {
    uploaded: 'Uploaded',
    pending: 'Pending',
    failed: 'Failed',
    normalized: 'Normalized',
    analyzed: 'Analyzed',
  }[status] || status;

  return (
    <div style={{ padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
      <h2 style={{ margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#389e0d' }}>✓ Capture Complete</h2>
      <div style={{ fontSize: 12, color: '#595959' }}>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: '#8c8c8c' }}>ID: </span>
          <code style={{ fontSize: 11, background: '#f0f0f0', padding: '1px 4px', borderRadius: 3 }}>{captureId}</code>
        </div>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: '#8c8c8c' }}>Status: </span>
          <span style={{ color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
        </div>
        {url && (
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#8c8c8c' }}>URL: </span>
            <span style={{ fontSize: 11, wordBreak: 'break-all' }}>{url.replace('http://', '').substring(0, 40)}</span>
          </div>
        )}
      </div>
    </div>
  );
}