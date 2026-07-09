/**
 * Progress Indicator — shows capture steps: Extract → Screenshot → Package → Upload
 */

import React from 'react';

const STEPS = ['Extract', 'Screenshot', 'Package', 'Upload'];

/** @param {{ currentStep: number }} props */
export default function ProgressIndicator({ currentStep }) {
  return (
    <div style={{ marginBottom: 12, padding: 12, background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#595959', marginBottom: 8 }}>Progress</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {STEPS.map((label, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <div
              key={label}
              style={{
                flex: 1,
                padding: '4px 2px',
                textAlign: 'center',
                fontSize: 10,
                borderRadius: 4,
                background: done ? '#e6f7e6' : active ? '#e6f4ff' : '#f5f5f5',
                color: done ? '#389e0d' : active ? '#1677ff' : '#8c8c8c',
                fontWeight: active ? 600 : 400,
                border: active ? '1px solid #1677ff' : '1px solid transparent',
                transition: 'all 0.3s',
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}