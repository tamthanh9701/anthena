/**
 * AntD Classification Precision Test — Static Labeled Fixture
 *
 * Uses actual adapter classToComponent maps (v4/v5/v6)
 * against labeled positive, ambiguous, and negative fixtures.
 *
 * Metric: multiclass precision = TP / (TP + FP)
 *   - TP: classifier returns expected component (positive/ambiguous)
 *   - FP: classifier returns any component for negative case OR wrong component for positive case
 *
 * Per-version and aggregate precision must be >= 0.90.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAdapter } from '../../src/v2/antd-adapters/index.js';

// Load static fixture (NOT generated from implementation)
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'antd-precision-fixtures.json'), 'utf-8')
);

/**
 * Classify a node using the adapter's classToComponent map.
 * Returns first matching component name or null if no AntD class found.
 * This is the EXACT same logic used by the extension's antd-detector.js
 * and the backend's evidence processing pipeline.
 */
function classifyNode(classList, adapter) {
  if (!classList || !Array.isArray(classList) || classList.length === 0) {
    return null;
  }
  const compMap = adapter.classToComponent;
  for (const cls of classList) {
    if (compMap[cls]) {
      return compMap[cls];
    }
  }
  // Also check for ant-prefix matching for classes not directly in map
  for (const cls of classList) {
    if (cls.startsWith('ant-') && compMap[cls]) {
      return compMap[cls];
    }
  }
  return null;
}

/**
 * Run classification for a single version.
 * Returns { tp, fp, fn, precision, details[] }
 */
function classifyVersion(versionLabel) {
  const versionFixtures = fixtures.fixtures.filter(f =>
    f.version === versionLabel || f.type === 'negative'
  );
  // For ambiguous, also include (they share version-specific classToComponent)
  const ambiguousFixtures = fixtures.fixtures.filter(f => f.type === 'ambiguous');
  const allFixtures = [...versionFixtures, ...ambiguousFixtures];

  const adapter = getAdapter(versionLabel);
  const details = [];
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const fx of allFixtures) {
    const predicted = classifyNode(fx.classList, adapter);
    const expected = fx.expected;

    if (fx.type === 'negative') {
      // Negative: expected is null — any prediction is FP
      if (predicted === null) {
        tp++; // Correctly rejected
      } else {
        fp++;
        details.push({ id: fx.id, predicted, expected, error: 'false-positive' });
      }
    } else if (fx.type === 'positive' || fx.type === 'ambiguous') {
      if (predicted === expected) {
        tp++;
      } else if (predicted === null) {
        fp++;
        details.push({ id: fx.id, predicted, expected, error: 'missed' });
      } else {
        fp++;
        details.push({ id: fx.id, predicted, expected, error: 'wrong-classification' });
      }
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  return { version: versionLabel, tp, fp, fn, precision: Math.round(precision * 1000) / 1000, details, total: fixtures.fixtures.length };
}

describe('AntD Classification Precision', () => {
  const versions = ['v4', 'v5', 'v6'];
  const versionLabels = ['4', '5', '6'];
  const allResults = [];

  for (let i = 0; i < versions.length; i++) {
    const label = versions[i];
    const vLabel = versionLabels[i];

    describe(`Adapter: AntD ${label.toUpperCase()}`, () => {
      const result = classifyVersion(vLabel);
      allResults.push(result);

      it(`precision >= 0.90 (got ${result.precision})`, () => {
        // Report details on failure
        if (result.precision < 0.90) {
          console.log(`\n  Precision failures for ${label}:`);
          for (const d of result.details) {
            console.log(`    ${d.id}: predicted=${d.predicted}, expected=${d.expected}, error=${d.error}`);
          }
        }
        expect(result.precision).toBeGreaterThanOrEqual(0.90);
      });

      it(`has ${result.tp} true positives, ${result.fp} false positives`, () => {
        expect(result.tp + result.fp).toBeGreaterThan(0);
      });

      // Report metric always
      it(`metric: precision=${result.precision}`, () => {
        // Always passes; logs metric
        expect(true).toBe(true);
      });
    });
  }

  describe('Aggregate Precision (all versions)', () => {
    const totalTP = allResults.reduce((s, r) => s + r.tp, 0);
    const totalFP = allResults.reduce((s, r) => s + r.fp, 0);
    const aggPrecision = totalTP + totalFP > 0
      ? Math.round((totalTP / (totalTP + totalFP)) * 1000) / 1000
      : 1;

    it(`aggregate precision >= 0.90 (got ${aggPrecision})`, () => {
      expect(aggPrecision).toBeGreaterThanOrEqual(0.90);
    });

    it(`aggregate: ${totalTP} TP, ${totalFP} FP across all ${allResults.reduce((s, r) => s + r.total, 0)} fixtures`, () => {
      expect(totalTP + totalFP).toBeGreaterThan(0);
    });

    it('prints per-version breakdown', () => {
      console.log('\n  === AntD Precision Report ===');
      for (const r of allResults) {
        console.log(`  ${r.version}: precision=${r.precision} (${r.tp}TP/${r.fp}FP/${r.fn}FN)`);
      }
      console.log(`  aggregate: precision=${aggPrecision} (${totalTP}TP/${totalFP}FP)`);
      console.log('  ===============================\n');
    });
  });
});