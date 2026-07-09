/**
 * Anthena V2 Popup — Scenario Manifest selector, Redact toggle, Capture button, Progress.
 *
 * @typedef {import('../shared/schema.js').ScenarioManifest} ScenarioManifest
 */

import React, { useState, useEffect, useCallback } from 'react';
import CaptureButton from './CaptureButton.js';
import ManifestSelector from './ManifestSelector.js';
import RunSelector from './RunSelector.js';
import UploadStatus from './UploadStatus.js';
import ProgressIndicator from './ProgressIndicator.js';
import { loadManifests, getActiveManifest, getActiveManifestId, setActiveManifestId } from '../shared/manifest-fixtures.js';

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

/** @type {'idle'|'configuring'|'ready'|'capturing'|'uploading'|'success'|'error'} */
const STATUS = {};

export default function App() {
  const [sessionState, setSessionState] = useState(/** @type {SessionState} */({}));
  const [status, setStatus] = useState(/** @type {'idle'|'configuring'|'ready'|'capturing'|'uploading'|'success'|'error'} */('idle'));
  const [progressStep, setProgressStep] = useState(0);
  const [error, setError] = useState('');
  const [lastCapture, setLastCapture] = useState(/** @type {{captureId?: string, status?: string, url?: string}|null} */(null));

  // ── Manifest state ──────────────────────────────────────────
  const [manifests, setManifests] = useState(/** @type {ScenarioManifest[]} */([]));
  const [activeManifest, setActiveManifest] = useState(/** @type {ScenarioManifest|null} */(null));
  const [redactEnabled, setRedactEnabled] = useState(true);

  // ── Init: load manifests and session state ──────────────────
  useEffect(() => {
    loadManifests().then((m) => setManifests(m));
    getActiveManifest().then((m) => setActiveManifest(m));

    // Load current session state
    chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' }, (response) => {
      if (response?.sessionId) {
        setSessionState(response);
        setStatus('ready');
      }
    });
  }, []);

  // ── Manifest change handler ─────────────────────────────────
  const handleManifestChange = useCallback(async (manifestId) => {
    await setActiveManifestId(manifestId);
    const m = manifests.find((x) => x.id === manifestId) || null;
    setActiveManifest(m);
  }, [manifests]);

  // ── Configure session ───────────────────────────────────────
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
        setSessionState((prev) => ({
          ...prev,
          ...config,
          sessionId: response.sessionId,
          runId: response.runId,
        }));
        setStatus('ready');
      }
    );
  }, []);

  // ── V2 Capture ──────────────────────────────────────────────
  const handleCapture = useCallback(async (routeKey) => {
    setStatus('capturing');
    setProgressStep(1);
    setError('');

    try {
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'CAPTURE_NOW_V2',
            manifest: activeManifest,
            redact: redactEnabled,
            routeKey,
          },
          (response) => {
            if (response.type === 'ERROR') {
              reject(new Error(response.error));
            } else {
              resolve(response);
            }
          }
        );
      });

      setProgressStep(4);
      setLastCapture(result);
      setStatus('success');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [activeManifest, redactEnabled]);

  return (
    <div style={{
      width: '100%',
      minWidth: 320,
      minHeight: '100vh',
      boxSizing: 'border-box',
      padding: 16,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 14,
      color: '#1a1a1a',
    }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 'bold' }}>A2</span>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1 }}>Anthena V2</h1>
        <span style={{
          fontSize: 11,
          padding: '2px 6px',
          borderRadius: 4,
          background: status === 'ready' ? '#e6f7e6' : '#f0f0f0',
          color: status === 'ready' ? '#389e0d' : '#8c8c8c',
        }}>
          {status === 'ready' ? 'Ready' : status === 'configuring' ? 'Connecting...' : status === 'capturing' ? 'Capturing' : 'Idle'}
        </span>
      </div>

      {/* ── Error ───────────────────────────────────────────── */}
      {error && (
        <div style={{ marginBottom: 12, padding: 8, background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, color: '#cf1322', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* ── Manifest Selector ───────────────────────────────── */}
      <ManifestSelector
        manifests={manifests}
        activeManifest={activeManifest}
        onManifestChange={handleManifestChange}
        disabled={status === 'capturing' || status === 'uploading'}
      />

      <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#595959', marginBottom: 8 }}>
          Optional Upload Target {sessionState.sessionId ? '(connected)' : '(local capture works without this)'}
        </summary>
        <RunSelector
          sessionState={sessionState}
          onConfigure={handleConfigure}
          disabled={status === 'configuring' || status === 'capturing' || status === 'uploading'}
        />
      </details>

      {/* ── Redact Toggle ───────────────────────────────────── */}
      <div style={{
        marginBottom: 12,
        padding: 12,
        background: '#fafafa',
        borderRadius: 8,
        border: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#595959' }}>Redact Text & Images</div>
          <div style={{ fontSize: 11, color: '#8c8c8c' }}>Structure + tokens survive</div>
        </div>
        <label style={{
          position: 'relative',
          display: 'inline-block',
          width: 44,
          height: 24,
        }}>
          <input
            type="checkbox"
            checked={redactEnabled}
            onChange={(e) => setRedactEnabled(e.target.checked)}
            style={{ display: 'none' }}
          />
          <span
            style={{
              position: 'absolute',
              cursor: 'pointer',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: 24,
              background: redactEnabled ? '#1677ff' : '#d9d9d9',
              transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute',
              content: '""',
              height: 20,
              width: 20,
              left: redactEnabled ? 22 : 2,
              bottom: 2,
              background: '#fff',
              borderRadius: '50%',
              transition: 'left 0.2s',
              display: 'block',
            }} />
          </span>
        </label>
      </div>

      {/* ── Capture Button ──────────────────────────────────── */}
      <CaptureButton
        sessionState={sessionState}
        onCapture={handleCapture}
        disabled={status === 'configuring' || status === 'capturing' || status === 'uploading'}
        capturing={status === 'capturing'}
        activeManifest={activeManifest}
      />

      {/* ── Progress ────────────────────────────────────────── */}
      {(status === 'capturing' || status === 'uploading') && (
        <ProgressIndicator currentStep={progressStep} />
      )}

      {/* ── Last Capture Status ─────────────────────────────── */}
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
