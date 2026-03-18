const config = require('./config.js');

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;

function createMetricsClient() {
  const state = {
    requestEvents: [],
    authEvents: [],
    purchaseEvents: [],
    activeUsers: new Map(),
    systemSample: null,
    flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
    flushTimer: null,
  };

  function isConfigured() {
    return !!(config.metrics?.endpointUrl && config.metrics?.accountId && config.metrics?.apiKey && config.metrics?.source);
  }

  function isEnabled() {
    return isConfigured() && typeof fetch === 'function';
  }

  function requestTracker(req, res, next) {
    next();
  }

  function trackAuthAttempt(event) {
    if (!isEnabled()) {
      return;
    }

    state.authEvents.push({
      action: event?.action ?? 'unknown',
      success: !!event?.success,
      timestamp: Date.now(),
    });
  }

  function trackActiveUser(user) {
    if (!isEnabled()) {
      return;
    }

    if (!user?.id) {
      return;
    }

    state.activeUsers.set(user.id, {
      userId: user.id,
      email: user.email ?? '',
      lastSeen: Date.now(),
    });
  }

  function trackPizzaPurchase(event) {
    if (!isEnabled()) {
      return;
    }

    state.purchaseEvents.push({
      success: !!event?.success,
      latencyMs: Number(event?.latencyMs ?? 0),
      itemCount: Number(event?.itemCount ?? 0),
      revenue: Number(event?.revenue ?? 0),
      timestamp: Date.now(),
    });
  }

  function collectSystemMetrics(sample) {
    if (!isEnabled()) {
      return;
    }

    state.systemSample = {
      cpuPercent: Number(sample?.cpuPercent ?? 0),
      memoryPercent: Number(sample?.memoryPercent ?? 0),
      timestamp: Date.now(),
    };
  }

  function buildMetricEnvelope() {
    return {
      source: config.metrics?.source,
      generatedAt: new Date().toISOString(),
      requests: state.requestEvents,
      auth: state.authEvents,
      purchases: state.purchaseEvents,
      activeUsers: Array.from(state.activeUsers.values()),
      system: state.systemSample,
    };
  }

  async function flush() {
    if (!isEnabled()) {
      return;
    }

    const envelope = buildMetricEnvelope();

    try {
      const response = await fetch(config.metrics.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${config.metrics.accountId}:${config.metrics.apiKey}`).toString('base64')}`,
        },
        body: JSON.stringify(envelope),
      });

      if (!response.ok) {
        console.error(`Failed to flush metrics: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error('Failed to flush metrics', err.message);
    }
  }

  function startReporter(intervalMs = DEFAULT_FLUSH_INTERVAL_MS) {
    if (!isEnabled()) {
      return;
    }

    state.flushIntervalMs = intervalMs;

    if (state.flushTimer) {
      clearInterval(state.flushTimer);
    }

    state.flushTimer = setInterval(() => {
      flush();
    }, state.flushIntervalMs);

    if (typeof state.flushTimer.unref === 'function') {
      state.flushTimer.unref();
    }
  }

  return {
    requestTracker,
    trackAuthAttempt,
    trackActiveUser,
    trackPizzaPurchase,
    collectSystemMetrics,
    startReporter,
    flush,
    isConfigured,
    isEnabled,
  };
}

module.exports = createMetricsClient();
