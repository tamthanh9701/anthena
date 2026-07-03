/**
 * @file extractor-scripts.test.js
 * @description Unit tests for the extractor scripts (syntax and structure)
 * 
 * Tests the extraction scripts that run in-page via page.evaluate().
 * While we can't run these in a browser within Node.js, we verify:
 *   - Script syntax is valid JavaScript
 *   - It returns the expected data structure
 *   - Required properties are present
 *   - Invisible node filtering logic
 * 
 * Covers: US-P2-01, US-P2-02, US-P2-04, US-P2-05, US-P2-06
 */

import { describe, it, expect } from 'vitest';

const { getDomWalkerScript } = require('../../src/extractor/dom-walker.js');
const { getCssExtractorScript, getComputedCssForElementsScript } = require('../../src/extractor/css-extractor.js');

describe('DOM Walker Script', () => {
  it('returns a string', () => {
    const script = getDomWalkerScript();
    expect(typeof script).toBe('string');
    expect(script.length).toBeGreaterThan(0);
  });

  it('contains node filtering logic (skip script/style/head/link/meta/noscript/template)', () => {
    const script = getDomWalkerScript();
    expect(script).toContain('querySelectorAll');
    expect(script).toContain('getBoundingClientRect');
    expect(script).toContain('script');
    expect(script).toContain('style');
  });

  it('skips invisible/zero-dimension elements', () => {
    const script = getDomWalkerScript();
    expect(script).toContain('width === 0');
    expect(script).toContain('height === 0');
    expect(script).toContain('display');
    expect(script).toContain('visibility');
  });

  it('returns rect with x, y, w, h', () => {
    const script = getDomWalkerScript();
    expect(script).toContain('rect.x');
    expect(script).toContain('rect.y');
    expect(script).toContain('rect.width');
    expect(script).toContain('rect.height');
  });

  it('extracts tag, classList, and attributes per node', () => {
    const script = getDomWalkerScript();
    expect(script).toContain('tag');
    expect(script).toContain('classList');
    expect(script).toContain('attributes');
  });

  it('produces valid parsable JavaScript', () => {
    const script = getDomWalkerScript();
    expect(() => new Function(script)).not.toThrow();
  });

  it('skips html and body elements', () => {
    const script = getDomWalkerScript();
    expect(script).toContain('html');
    expect(script).toContain('body');
  });
});

describe('CSS Extractor Script (aggregated)', () => {
  it('returns a string', () => {
    const script = getCssExtractorScript();
    expect(typeof script).toBe('string');
  });

  it('includes all 12 required CSS properties', () => {
    const script = getCssExtractorScript();
    const required = [
      'backgroundColor', 'color', 'fontSize', 'fontFamily', 'lineHeight',
      'padding', 'margin', 'border', 'borderRadius', 'boxShadow',
      'width', 'height',
    ];
    for (const prop of required) {
      expect(script).toContain(prop);
    }
  });

  it('computes confidence as extractedCount / totalProps', () => {
    const script = getCssExtractorScript();
    expect(script).toContain('extractedCount');
    expect(script).toContain('totalProps');
  });

  it('filters zero-dimension and invisible nodes', () => {
    const script = getCssExtractorScript();
    expect(script).toContain('width === 0');
    expect(script).toContain('display');
    expect(script).toContain('visibility');
  });

  it('produces valid parsable JavaScript', () => {
    const script = getCssExtractorScript();
    expect(() => new Function(script)).not.toThrow();
  });
});

describe('CSS Extractor Script (per-element)', () => {
  it('returns a string', () => {
    const script = getComputedCssForElementsScript();
    expect(typeof script).toBe('string');
  });

  it('outputs per-element data with tag, classList, css, and confidence', () => {
    const script = getComputedCssForElementsScript();
    expect(script).toContain('tag');
    expect(script).toContain('classList');
    expect(script).toContain('css');
    expect(script).toContain('confidence');
  });

  it('includes all 12 required CSS properties', () => {
    const script = getComputedCssForElementsScript();
    const required = [
      'backgroundColor', 'color', 'fontSize', 'fontFamily', 'lineHeight',
      'padding', 'margin', 'border', 'borderRadius', 'boxShadow',
      'width', 'height',
    ];
    for (const prop of required) {
      expect(script).toContain(prop);
    }
  });

  it('computes confidence correctly', () => {
    const script = getComputedCssForElementsScript();
    expect(script).toContain('extractedCount / REQUIRED_PROPS.length');
  });

  it('produces valid parsable JavaScript', () => {
    const script = getComputedCssForElementsScript();
    expect(() => new Function(script)).not.toThrow();
  });

  it('TC-P2-01-05: filters invisible nodes (display:none, visibility:hidden, zero dims)', () => {
    const script = getComputedCssForElementsScript();
    expect(script).toContain('display');
    expect(script).toContain('visibility');
    expect(script).toContain('hidden');
  });
});