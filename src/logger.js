const config = require('./config.js');

const REDACTED = '[REDACTED]';
const SECRET_KEY_PATTERN = /(password|token|jwt|authorization|api[_-]?key|secret)/i;

function createLoggerClient() {
  let processHandlersRegistered = false;

  function isConfigured() {
    return !!(config.logging?.endpointUrl && config.logging?.accountId && config.logging?.apiKey && config.logging?.source);
  }

  function isEnabled() {
    return isConfigured() && typeof fetch === 'function';
  }

  function sanitize(value) {
    const sanitized = sanitizeValue(value, new WeakSet());
    return sanitizeStringPatterns(sanitized);
  }

  function sanitizeValue(value, seen) {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return sanitizeStringPatterns(value);
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, seen));
    }

    const sanitized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        sanitized[key] = REDACTED;
      } else {
        sanitized[key] = sanitizeValue(nestedValue, seen);
      }
    }

    return sanitized;
  }

  function sanitizeStringPatterns(value) {
    if (typeof value !== 'string') {
      return value;
    }

    return value
      .replace(/(authorization['"]?\s*[:=]\s*['"]?)(basic|bearer)\s+[^'",\s}]+/gi, `$1${REDACTED}`)
      .replace(/((?:password|token|jwt|authorization|api[_-]?key|secret)['"]?\s*[:=]\s*['"]?)([^'",}\s]+)/gi, `$1${REDACTED}`)
      .replace(/\bBearer\s+[A-Za-z0-9\-_=:.+/]+\b/gi, `Bearer ${REDACTED}`)
      .replace(/\bBasic\s+[A-Za-z0-9+/=]+\b/gi, `Basic ${REDACTED}`)
      .replace(/\bglc_[A-Za-z0-9._-]+\b/g, REDACTED)
      .replace(/\b[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/g, REDACTED);
  }

  function nowString() {
    return `${BigInt(Date.now()) * 1_000_000n}`;
  }

  function stringifyLogData(logData) {
    const sanitized = sanitize(logData);
    return typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized);
  }

  function buildLogEvent(level, type, logData) {
    return {
      streams: [
        {
          stream: {
            component: 'jwt-pizza-service',
            source: config.logging.source,
            level,
            type,
          },
          values: [[nowString(), stringifyLogData(logData)]],
        },
      ],
    };
  }

  function log(level, type, logData) {
    if (!isEnabled()) {
      return;
    }

    sendLogToGrafana(buildLogEvent(level, type, logData));
  }

  async function sendLogToGrafana(event) {
    if (!isEnabled()) {
      return;
    }

    try {
      const response = await fetch(config.logging.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${config.logging.accountId}:${config.logging.apiKey}`).toString('base64')}`,
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        console.log(`Failed to send log to Grafana: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.log(`Failed to send log to Grafana: ${err.message}`);
    }
  }

  function httpLogger(req, res, next) {
    if (!isEnabled()) {
      next();
      return;
    }

    let responseBody;
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);

    res.send = (body) => {
      responseBody = body;
      return originalSend(body);
    };

    res.json = (body) => {
      responseBody = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      const level = statusToLogLevel(res.statusCode);
      log(level, 'http', {
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode: res.statusCode,
        authorized: !!req.headers.authorization,
        reqBody: req.body ?? null,
        resBody: responseBody ?? null,
      });
    });

    next();
  }

  function statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  function logUnhandledException(error, context = {}) {
    const err = error instanceof Error ? error : new Error(String(error));
    log('error', 'exception', {
      ...context,
      message: err.message,
      stack: err.stack,
    });
  }

  function registerProcessHandlers(targetProcess = process) {
    if (processHandlersRegistered) {
      return;
    }

    targetProcess.on('uncaughtException', (error) => {
      logUnhandledException(error, { origin: 'uncaughtException' });
    });

    targetProcess.on('unhandledRejection', (reason) => {
      logUnhandledException(reason, { origin: 'unhandledRejection' });
    });

    processHandlersRegistered = true;
  }

  return {
    isEnabled,
    sanitize,
    httpLogger,
    log,
    logUnhandledException,
    registerProcessHandlers,
  };
}

module.exports = createLoggerClient();
