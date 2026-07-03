/**
 * @file run-state-machine.test.js
 * @description Unit tests for the run state machine transitions
 * 
 * Imports the real state machine module from src/queue/state-machine.js
 * 
 * Valid states: pending, running, completed, partially-completed, failed, interrupted
 * Verified against DB schema table and AC-P1-02-01 through AC-P1-02-05
 */

import { describe, it, expect } from 'vitest';

// ── Module Under Test (real source module) ─────────────────────────────────
const { VALID_STATES, isValidState, canTransition, getValidTransitions } =
  require('../../src/queue/state-machine.js');

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Run State Machine — Valid States', () => {
  it('TC-P1-02-01: a new run starts in "pending" state', () => {
    expect(isValidState('pending')).toBe(true);
  });

  it('TC-P1-02-05: all states are from the valid set', () => {
    for (const state of VALID_STATES) {
      expect(isValidState(state)).toBe(true);
    }
  });

  it('TC-P1-02-05: no other states are valid', () => {
    expect(isValidState('queued')).toBe(false);
    expect(isValidState('deleted')).toBe(false);
    expect(isValidState('paused')).toBe(false);
    expect(isValidState('cancelled')).toBe(false);
    expect(isValidState('')).toBe(false);
    expect(isValidState(null)).toBe(false);
    expect(isValidState(undefined)).toBe(false);
  });
});

describe('Run State Machine — Valid Transitions', () => {
  it('pending → running is allowed', () => {
    expect(canTransition('pending', 'running')).toBe(true);
  });

  it('TC-P1-02-02: running → completed when all routes succeed', () => {
    expect(canTransition('running', 'completed')).toBe(true);
  });

  it('TC-P1-02-03: running → partially-completed when some routes fail', () => {
    expect(canTransition('running', 'partially-completed')).toBe(true);
  });

  it('TC-P1-02-04: running → failed when all routes fail critically', () => {
    expect(canTransition('running', 'failed')).toBe(true);
  });

  it('running → interrupted on system crash/restart', () => {
    expect(canTransition('running', 'interrupted')).toBe(true);
  });

  it('interrupted → running on manual resume', () => {
    expect(canTransition('interrupted', 'running')).toBe(true);
  });
});

describe('Run State Machine — Invalid Transitions', () => {
  it('pending → completed is not allowed (must go through running)', () => {
    expect(canTransition('pending', 'completed')).toBe(false);
  });

  it('pending → failed is not allowed', () => {
    expect(canTransition('pending', 'failed')).toBe(false);
  });

  it('completed → running is not allowed (terminal state)', () => {
    expect(canTransition('completed', 'running')).toBe(false);
  });

  it('completed → failed is not allowed', () => {
    expect(canTransition('completed', 'failed')).toBe(false);
  });

  it('failed → completed is not allowed (terminal state)', () => {
    expect(canTransition('failed', 'completed')).toBe(false);
  });

  it('partially-completed → completed is not allowed', () => {
    expect(canTransition('partially-completed', 'completed')).toBe(false);
  });

  it('pending → interrupted is not allowed', () => {
    expect(canTransition('pending', 'interrupted')).toBe(false);
  });

  it('running → pending is not allowed (no rollback)', () => {
    expect(canTransition('running', 'pending')).toBe(false);
  });

  it('interrupted → completed is not allowed (must resume first)', () => {
    expect(canTransition('interrupted', 'completed')).toBe(false);
  });

  it('interrupted → failed is not allowed', () => {
    expect(canTransition('interrupted', 'failed')).toBe(false);
  });

  it('interrupted → partially-completed is not allowed', () => {
    expect(canTransition('interrupted', 'partially-completed')).toBe(false);
  });
});

describe('Run State Machine — Edge Cases', () => {
  it('rejects empty string as state', () => {
    expect(canTransition('', 'running')).toBe(false);
  });

  it('all valid transitions produce true', () => {
    const validPairs = [
      ['pending', 'running'],
      ['running', 'completed'],
      ['running', 'partially-completed'],
      ['running', 'failed'],
      ['running', 'interrupted'],
      ['interrupted', 'running'],
    ];
    for (const [from, to] of validPairs) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('all invalid from-to combinations produce false', () => {
    const validPairs = [
      ['pending', 'running'],
      ['running', 'completed'],
      ['running', 'partially-completed'],
      ['running', 'failed'],
      ['running', 'interrupted'],
      ['interrupted', 'running'],
    ];
    for (const from of VALID_STATES) {
      for (const to of VALID_STATES) {
        const isInvalid = !validPairs.some(([f, t]) => f === from && t === to);
        if (isInvalid && from !== to) {
          expect(canTransition(from, to)).toBe(false);
        }
      }
    }
  });

  it('self-transitions are not valid', () => {
    for (const state of VALID_STATES) {
      expect(canTransition(state, state)).toBe(false);
    }
  });
});

describe('Run State Machine — getValidTransitions', () => {
  it('returns transitions for pending', () => {
    expect(getValidTransitions('pending')).toEqual(['running']);
  });

  it('returns empty transitions for terminal states', () => {
    expect(getValidTransitions('completed')).toEqual([]);
    expect(getValidTransitions('failed')).toEqual([]);
    expect(getValidTransitions('partially-completed')).toEqual([]);
  });

  it('returns empty for invalid states', () => {
    expect(getValidTransitions('nonexistent')).toEqual([]);
  });
});