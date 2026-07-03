'use strict';

/**
 * Run state machine.
 * Validates state transitions for the run lifecycle.
 */

const VALID_STATES = ['pending', 'running', 'completed', 'partially-completed', 'failed', 'interrupted'];

const ALLOWED_TRANSITIONS = {
  'pending': ['running'],
  'running': ['completed', 'partially-completed', 'failed', 'interrupted'],
  'interrupted': ['running'],
  'completed': [],
  'partially-completed': [],
  'failed': [],
};

function isValidState(state) {
  return VALID_STATES.includes(state);
}

function canTransition(from, to) {
  if (!isValidState(from) || !isValidState(to)) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) || false;
}

function getValidTransitions(from) {
  return ALLOWED_TRANSITIONS[from] || [];
}

module.exports = { VALID_STATES, isValidState, canTransition, getValidTransitions, ALLOWED_TRANSITIONS };