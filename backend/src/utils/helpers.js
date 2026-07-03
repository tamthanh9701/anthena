'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Creates a standardized error response object.
 */
function createErrorResponse(error, code, requestId, details = null, gate = null) {
  const resp = { error, code, requestId: requestId || `req-${uuidv4().slice(0, 8)}` };
  if (gate) resp.gate = gate;
  if (details) resp.details = details;
  return resp;
}

/**
 * Creates a pagination helper.
 */
function paginate(page = 1, limit = 20) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * l;
  return { page: p, limit: l, offset };
}

/**
 * Validates a URL is absolute and well-formed.
 */
function isValidAbsoluteUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates UUID format.
 */
function isValidUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Validates a route list has 5-10 absolute URLs.
 */
function validateRouteList(routes) {
  if (!Array.isArray(routes)) return 'Route list must be an array';
  if (routes.length < 5 || routes.length > 10) return 'Route list must contain 5-10 URLs';
  for (const r of routes) {
    if (!isValidAbsoluteUrl(r)) return `Invalid or non-absolute URL: ${r}`;
  }
  return null;
}

/**
 * Check if a pilot contract has all required fields for co-sign.
 */
function validatePilotContractForCosign(contract) {
  if (!contract) return 'No pilot contract exists';
  if (contract.cosignedAt) return null; // Already signed, valid
  const errors = [];
  if (!contract.operatorName) errors.push('operatorName is required');
  if (!contract.operatorRole) errors.push('operatorRole is required');
  if (!contract.environment) errors.push('environment is required');
  const routeErr = validateRouteList(contract.routeList);
  if (routeErr) errors.push(routeErr);
  if (!contract.reviewBudgetMinutes || contract.reviewBudgetMinutes < 1) errors.push('reviewBudgetMinutes must be ≥ 1');
  if (!contract.maxCandidates || contract.maxCandidates < 1) errors.push('maxCandidates must be ≥ 1');
  if (!contract.reviewMode) errors.push('reviewMode is required');
  if (!Array.isArray(contract.definitionOfInsight) || contract.definitionOfInsight.length < 1) errors.push('definitionOfInsight must have at least 1 item');
  if (!Array.isArray(contract.phase0DoD) || contract.phase0DoD.length < 1) errors.push('phase0DoD must have at least 1 item');
  if (!Array.isArray(contract.pilotDoD) || contract.pilotDoD.length < 1) errors.push('pilotDoD must have at least 1 item');
  return errors.length > 0 ? errors.join('; ') : null;
}

module.exports = {
  createErrorResponse,
  paginate,
  isValidAbsoluteUrl,
  isValidUuid,
  validateRouteList,
  validatePilotContractForCosign,
};