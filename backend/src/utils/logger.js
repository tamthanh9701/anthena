'use strict';

const pino = require('pino');
const config = require('../config');

const LOG_SANITIZER = /(password|secret|token|credential)=([^\s&"]+)/gi;

function sanitize(obj) {
  if (typeof obj === 'string') return obj.replace(LOG_SANITIZER, '$1=****');
  if (obj && typeof obj === 'object') {
    const out = Array.isArray(obj) ? [...obj] : { ...obj };
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === 'string') {
        out[k] = v.replace(LOG_SANITIZER, '$1=****');
      } else if (v && typeof v === 'object') {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return obj;
}

const logger = pino({
  level: config.logLevel,
  formatters: {
    level(label) { return { level: label }; },
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: (req) => sanitize({
      method: req.method,
      url: req.url,
      headers: { ...req.headers, authorization: req.headers.authorization ? 'Bearer ****' : undefined },
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: 'message',
});

// Convenience wrapper that adds sanitization
function childLogger(bindings) {
  return logger.child(sanitize(bindings));
}

module.exports = { logger, childLogger, sanitize };