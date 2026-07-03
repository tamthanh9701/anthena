import React, { useState, useEffect, useCallback } from 'react';
import CaptureButton from './CaptureButton.js';
import RunSelector from './RunSelector.js';
import UploadStatus from './UploadStatus.js';

/**
 * @typedef {{
 *   sessionId?: string,
 *   runId?: string, 
 *   uploadUrl?: string,
 *   uploadToken?: string,
 *   apiBaseUrl?: string,
 *   adminToken?: string
 * }} SessionState
 */

export default function App() {
  const [sessionState, setSessionState] = useState(/** @type {SessionState} */({}));
  const [status, setStatus] = useState(/** @type {'idle'|'configuring'|'ready'|'capturing'|'uploading'|'success'|'error'} */('idle'));
  const [error, setError] = useState('');
  const [lastCapture, setLastCapture] = useState(/** @type {{captureId?: string, status?: string, url?: string}|null} */(null));

  useEffect(() => {
    // Load current session state
    chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' }, (response) => {
      if (response?.sessionId) {
        setSessionState(response);
        setStatus('ready');
      }
    });
  }, []);

  const handleConfigure = useCallback(async (config) => {
    setStatus('configuring');
    setError('');

    chrome.runtime.sendMessage(
      { type: 'CONFIGURE_SESSION', ...config },
      (response) => {
        if (response.type === 'ERROR') {
          setError(response.error);
          setStatus('error');
          return;
        }
        setSessionState(prev => ({
          ...prev,
          sessionId: response.sessionId,
          runId: response.runId,
        }));
        setStatus('ready');
      }
    );
  }, []);

  const handleCapture = useCallback(async (routeKey) => {
    setStatus('capturing');
    setError('');

    chrome.runtime.sendMessage(
      { type: 'CAPTURE_NOW', routeKey },
      (response) => {
        if (response.type === 'ERROR') {
          setError(response.error);
          setStatus('error');
          return;
        }
        setLastCapture(response);
        setStatus('success');
      }
    );
  }, []);

  return (
    <div style={{
      width: 360,
      padding: 16,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 14,
      color: '#1a1a1a',
    }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20 }}>📷</span>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1 }}>Anthena Capture</h1>
        <span style={{
          fontSize: 11,
          padding: '2px 6px',
          borderRadius: 4,
          background: status === 'ready' ? '#e6f7e6' : '#f0f0f0',
          color: status === 'ready' ? '#389e0d' : '#8c8c8c',
        }}>
          {status === 'ready' ? 'Connected' : status === 'configuring' ? 'Connecting...' : 'Disconnected'}
        </span>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 8, background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, color: '#cf1322', fontSize: 12 }}>
          {error}
        </div>
      )}

      <RunSelector
        sessionState={sessionState}
        onConfigure={handleConfigure}
        disabled={status === 'configuring' || status === 'capturing'}
      />

      <CaptureButton
        sessionState={sessionState}
        onCapture={handleCapture}
        disabled={status !== 'ready'}
        capturing={status === 'capturing'}
      />

      {lastCapture && (
        <UploadStatus
          captureId={lastCapture.captureId}
          status={lastCapture.status}
          url={lastCapture.url}
        />
      )}
    </div>
  );
}