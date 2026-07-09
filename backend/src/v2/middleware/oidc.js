'use strict';

/**
 * V2 OIDC/SSO Authentication Middleware
 *
 * Verifies JWTs from an OIDC provider using JWKS.
 * Supports role extraction from realm_access.roles and resource_access.{client}.roles.
 *
 * Environment: OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URL
 * If OIDC_ISSUER_URL is not set, runs in dev bypass mode (all requests get Admin role).
 */

const config = require('../../config');
const { createErrorResponse } = require('../../utils/helpers');
const { logger } = require('../../utils/logger');

// ── Lazy JWKS client & jwks-rsa/jsonwebtoken requires (may not be installed) ──
let jwksClient = null;
let jwt = null;
let importedModules = false;

function ensureModules() {
  if (importedModules) return;
  try {
    jwksClient = require('jwks-rsa');
    jwt = require('jsonwebtoken');
  } catch (e) {
    logger.warn({ err: e.message }, 'jwks-rsa or jsonwebtoken not installed; OIDC auth will fail for real tokens');
  }
  importedModules = true;
}

// ── OIDC issuer URL ──
const OIDC_ISSUER_URL = process.env.OIDC_ISSUER_URL || '';
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID || '';

// ── Cached JWKS client ──
let jwksClientInstance = null;
let jwksLastRefresh = 0;
const JWKS_REFRESH_MS = 60 * 60 * 1000; // 1 hour

function getJwksClient() {
  if (jwksClientInstance && Date.now() - jwksLastRefresh < JWKS_REFRESH_MS) {
    return jwksClientInstance;
  }
  if (!jwksClient) return null;
  jwksClientInstance = jwksClient({
    jwksUri: `${OIDC_ISSUER_URL.replace(/\/$/, '')}/.well-known/openid-configuration`,
    cache: true,
    cacheMaxAge: JWKS_REFRESH_MS,
    rateLimit: true,
  });
  jwksLastRefresh = Date.now();
  return jwksClientInstance;
}

// ── Dev bypass ──
const isDevBypass = !OIDC_ISSUER_URL;

if (isDevBypass) {
  logger.warn('OIDC_ISSUER_URL not set — auth in dev bypass mode (all requests -> Admin)');
}

// ── Skip paths ──
const SKIP_PATHS = ['/health', '/ready'];
const SKIP_PREFIXES = ['/api/v2/auth'];

function shouldSkipPath(path) {
  if (SKIP_PATHS.includes(path)) return true;
  for (const prefix of SKIP_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

// ── Role mapping ──
const ROLE_MAP = {
  admin: 'Admin',
  reviewer: 'Reviewer',
  operator: 'Operator',
};

/**
 * Extract roles from an OIDC token payload.
 * Checks realm_access.roles and resource_access.{clientId}.roles.
 */
function extractRoles(payload) {
  const roles = new Set();

  // realm-level roles
  const realmRoles = payload.realm_access?.roles;
  if (Array.isArray(realmRoles)) {
    for (const r of realmRoles) {
      const mapped = ROLE_MAP[r.toLowerCase()];
      if (mapped) roles.add(mapped);
    }
  }

  // resource-access / client-level roles
  const clientRoles = payload.resource_access?.[OIDC_CLIENT_ID]?.roles;
  if (Array.isArray(clientRoles)) {
    for (const r of clientRoles) {
      const mapped = ROLE_MAP[r.toLowerCase()];
      if (mapped) roles.add(mapped);
    }
  }

  return roles.size > 0 ? Array.from(roles) : ['Operator']; // default fallback
}

/**
 * Verify a JWT against the OIDC provider's JWKS.
 * Returns decoded payload on success, throws on failure.
 */
function verifyToken(token) {
  return new Promise((resolve, reject) => {
    ensureModules();
    if (!jwt || !jwksClient) {
      return reject(new Error('JWKS dependencies not installed'));
    }

    const client = getJwksClient();
    if (!client) {
      return reject(new Error('Failed to create JWKS client'));
    }

    function getKey(header, callback) {
      client.getSigningKey(header.kid, (err, key) => {
        if (err) return callback(err);
        const signingKey = key.getPublicKey();
        callback(null, signingKey);
      });
    }

    jwt.verify(token, getKey, {
      algorithms: ['RS256', 'RS384', 'RS512'],
      issuer: OIDC_ISSUER_URL.replace(/\/$/, ''),
      ignoreExpiration: false,
    }, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Middleware: oidcAuthMiddleware
// ═══════════════════════════════════════════════════════════════════════════

function oidcAuthMiddleware(req, res, next) {
  // 1. Skip health/ready/auth routes
  if (shouldSkipPath(req.path)) {
    return next();
  }

  // 2. Dev bypass
  if (isDevBypass) {
    req.auth = { type: 'dev', roles: ['Admin'] };
    return next();
  }

  // 3. Read Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    logger.warn({ path: req.path, ip: req.ip }, 'OIDC auth failure: no authorization header');
    return res.status(401).json(createErrorResponse('Unauthorized', 'UNAUTHORIZED', req.requestId));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    logger.warn({ path: req.path }, 'OIDC auth failure: malformed authorization header');
    return res.status(401).json(createErrorResponse('Unauthorized', 'UNAUTHORIZED', req.requestId));
  }

  const token = parts[1];

  // 4. Verify JWT
  verifyToken(token)
    .then((decoded) => {
      const roles = extractRoles(decoded);
      req.auth = {
        type: 'oidc',
        sub: decoded.sub,
        email: decoded.email || '',
        name: decoded.name || decoded.preferred_username || decoded.sub,
        roles,
      };
      next();
    })
    .catch((err) => {
      logger.warn({ path: req.path, err: err.message }, 'OIDC auth failure: token verification failed');
      return res.status(401).json(createErrorResponse('Unauthorized', 'UNAUTHORIZED', req.requestId));
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Middleware factory: requireRole(...allowedRoles)
// ═══════════════════════════════════════════════════════════════════════════

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    // Skip role check on auth endpoints
    if (shouldSkipPath(req.path)) {
      return next();
    }

    const userRoles = req.auth?.roles || [];
    const hasRole = allowedRoles.some(role => userRoles.includes(role));

    if (!hasRole) {
      logger.warn({
        path: req.path,
        method: req.method,
        user: req.auth?.sub,
        requiredRoles: allowedRoles,
        userRoles,
      }, 'OIDC auth failure: insufficient permissions');
      return res.status(403).json(createErrorResponse('Forbidden', 'FORBIDDEN', req.requestId));
    }

    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  oidcAuthMiddleware,
  requireRole,
  // Exposed for testing
  extractRoles,
  shouldSkipPath,
};