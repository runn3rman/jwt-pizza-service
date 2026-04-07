const os = require('os');
const config = require('./config.js');

const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const AGGREGATION_TEMPORALITY_CUMULATIVE = 2;

function createMetricsClient() {
  const state = {
    requestEvents: [],
    authEvents: [],
    purchaseEvents: [],
    chaosEvents: [],
    activeUsers: new Map(),
    systemSample: null,
    flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
    flushTimer: null,
    lastFlushAtMs: Date.now(),
    totals: {
      requests: 0,
      requestsByMethod: {},
      responsesByStatusClass: {},
      authAttemptsByResult: {},
      pizzasSold: 0,
      pizzaFailures: 0,
      chaosFailures: 0,
      chaosStateChanges: 0,
      revenue: 0,
    },
  };

  function isConfigured() {
    return !!(config.metrics?.endpointUrl && config.metrics?.accountId && config.metrics?.apiKey && config.metrics?.source);
  }

  function isEnabled() {
    return isConfigured() && typeof fetch === 'function';
  }

  function normalizePath(pathname = '/') {
    if (pathname === '/') {
      return '/';
    }

    if (pathname.startsWith('/api/auth')) {
      return '/api/auth';
    }

    if (pathname.startsWith('/api/order/menu')) {
      return '/api/order/menu';
    }

    if (pathname.startsWith('/api/order')) {
      return '/api/order';
    }

    if (pathname.startsWith('/api/user')) {
      return '/api/user';
    }

    if (pathname.startsWith('/api/franchise')) {
      return '/api/franchise';
    }

    if (pathname.startsWith('/api/docs')) {
      return '/api/docs';
    }

    return pathname;
  }

  function requestTracker(req, res, next) {
    if (!isEnabled()) {
      next();
      return;
    }

    const startedAt = Date.now();
    const normalizedPath = normalizePath(req.path || req.originalUrl || '/');

    res.on('finish', () => {
      const statusClass = `${Math.floor((res.statusCode ?? 0) / 100)}xx`;

      if (req.user?.id) {
        trackActiveUser(req.user);
      }

      state.requestEvents.push({
        method: req.method,
        path: normalizedPath,
        statusCode: res.statusCode,
        statusClass,
        latencyMs: Date.now() - startedAt,
        timestamp: Date.now(),
      });

      state.totals.requests += 1;
      state.totals.requestsByMethod[req.method] = (state.totals.requestsByMethod[req.method] ?? 0) + 1;
      state.totals.responsesByStatusClass[statusClass] = (state.totals.responsesByStatusClass[statusClass] ?? 0) + 1;
    });

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

    const result = event?.success ? 'success' : 'failure';
    state.totals.authAttemptsByResult[result] = (state.totals.authAttemptsByResult[result] ?? 0) + 1;
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

    if (event?.success) {
      state.totals.pizzasSold += Number(event?.itemCount ?? 0);
      state.totals.revenue += Number(event?.revenue ?? 0);
    } else {
      state.totals.pizzaFailures += 1;
    }
  }

  function trackChaos(event) {
    if (!isEnabled()) {
      return;
    }

    const enabled = !!event?.enabled;
    const injectedFailure = !!event?.injectedFailure;

    state.chaosEvents.push({
      enabled,
      injectedFailure,
      timestamp: Date.now(),
    });

    if (Object.prototype.hasOwnProperty.call(event ?? {}, 'enabled')) {
      state.totals.chaosStateChanges += 1;
    }

    if (injectedFailure) {
      state.totals.chaosFailures += 1;
    }
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

  function getCpuUsagePercentage() {
    const cpuUsage = os.loadavg()[0] / os.cpus().length;
    return Number((cpuUsage * 100).toFixed(2));
  }

  function getMemoryUsagePercentage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    return Number(((usedMemory / totalMemory) * 100).toFixed(2));
  }

  function collectSystemMetricsSnapshot() {
    collectSystemMetrics({
      cpuPercent: getCpuUsagePercentage(),
      memoryPercent: getMemoryUsagePercentage(),
    });
  }

  function recordIngestionTestMetrics() {
    if (!isEnabled()) {
      return false;
    }

    state.requestEvents.push({
      method: 'TEST',
      path: '/metrics/ingestion-check',
      statusCode: 200,
      latencyMs: 123,
      timestamp: Date.now(),
    });
    state.totals.requests += 1;
    state.totals.requestsByMethod.TEST = (state.totals.requestsByMethod.TEST ?? 0) + 1;
    state.totals.responsesByStatusClass['2xx'] = (state.totals.responsesByStatusClass['2xx'] ?? 0) + 1;

    state.authEvents.push({
      action: 'ingestion-check',
      success: true,
      timestamp: Date.now(),
    });
    state.totals.authAttemptsByResult.success = (state.totals.authAttemptsByResult.success ?? 0) + 1;

    state.activeUsers.set('ingestion-check-user', {
      userId: 'ingestion-check-user',
      email: 'ingestion-check@jwt-pizza-service.local',
      lastSeen: Date.now(),
    });

    state.systemSample = {
      cpuPercent: 12.34,
      memoryPercent: 45.67,
      timestamp: Date.now(),
    };
    state.totals.chaosStateChanges += 1;
    state.totals.chaosFailures += 1;
    state.totals.pizzasSold += 2;
    state.totals.revenue += 19.98;

    return true;
  }

  function toUnixNano(timestampMs) {
    return `${BigInt(timestampMs) * 1_000_000n}`;
  }

  function createAttributes(attributes = {}) {
    return Object.entries(attributes).map(([key, value]) => ({
      key,
      value: { stringValue: String(value) },
    }));
  }

  function createResourceAttributes() {
    return createAttributes({
      'service.name': config.metrics.source,
      'service.namespace': 'jwt-pizza-service',
      'deployment.environment': config.metrics.source.endsWith('-dev') ? 'development' : 'production',
    });
  }

  function buildMetricDefinitions() {
    const nowMs = Date.now();
    const activeUserCount = Array.from(state.activeUsers.values()).filter((user) => nowMs - user.lastSeen <= 5 * 60_000).length;
    const latencyByPath = {};
    let pizzaLatencyTotalMs = 0;
    let pizzaLatencyCount = 0;

    for (const event of state.requestEvents) {
      if (!latencyByPath[event.path]) {
        latencyByPath[event.path] = { totalLatencyMs: 0, count: 0 };
      }

      latencyByPath[event.path].totalLatencyMs += event.latencyMs;
      latencyByPath[event.path].count += 1;
    }

    for (const event of state.purchaseEvents) {
      pizzaLatencyTotalMs += event.latencyMs;
      pizzaLatencyCount += 1;
    }

    const metrics = [
      {
        name: 'jwt_pizza_service_http_requests',
        description: 'Total HTTP requests seen by the service',
        unit: '1',
        type: 'sum',
        valueType: 'int',
        value: state.totals.requests,
        attributes: {},
        startTimeMs: state.lastFlushAtMs,
        endTimeMs: nowMs,
      },
    ];

    for (const [method, value] of Object.entries(state.totals.requestsByMethod)) {
      metrics.push(
        {
          name: 'jwt_pizza_service_http_requests',
          description: 'HTTP requests by method seen by the service',
          unit: '1',
          type: 'sum',
          valueType: 'int',
          value,
          attributes: { 'http.request.method': method },
          startTimeMs: state.lastFlushAtMs,
          endTimeMs: nowMs,
        }
      );
    }

    for (const [statusClass, value] of Object.entries(state.totals.responsesByStatusClass)) {
      metrics.push(
        {
          name: 'jwt_pizza_service_http_responses',
          description: 'HTTP responses by status class seen by the service',
          unit: '1',
          type: 'sum',
          valueType: 'int',
          value,
          attributes: { 'http.response.status_class': statusClass },
          startTimeMs: state.lastFlushAtMs,
          endTimeMs: nowMs,
        }
      );
    }

    for (const [path, latency] of Object.entries(latencyByPath)) {
      metrics.push(
        {
          name: 'jwt_pizza_service_http_request_latency_ms',
          description: 'Average HTTP request latency in milliseconds by endpoint for the current export window',
          unit: 'ms',
          type: 'gauge',
          valueType: 'double',
          value: latency.totalLatencyMs / latency.count,
          attributes: { 'http.route': path },
          endTimeMs: nowMs,
        }
      );
    }

    for (const [result, value] of Object.entries(state.totals.authAttemptsByResult)) {
      metrics.push(
        {
          name: 'jwt_pizza_service_auth_attempts',
          description: 'Authentication attempts by result seen by the service',
          unit: '1',
          type: 'sum',
          valueType: 'int',
          value,
          attributes: { result },
          startTimeMs: state.lastFlushAtMs,
          endTimeMs: nowMs,
        }
      );
    }

    metrics.push(
      {
        name: 'jwt_pizza_service_active_users',
        description: 'Authenticated users seen in the last five minutes',
        unit: '1',
        type: 'gauge',
        valueType: 'double',
        value: activeUserCount,
        attributes: {},
        endTimeMs: nowMs,
      }
    );

    metrics.push(
      {
        name: 'jwt_pizza_service_pizzas_sold',
        description: 'Pizza items sold by the service',
        unit: '1',
        type: 'sum',
        valueType: 'int',
        value: state.totals.pizzasSold,
        attributes: {},
        startTimeMs: state.lastFlushAtMs,
        endTimeMs: nowMs,
      }
    );

    metrics.push(
      {
        name: 'jwt_pizza_service_pizza_creation_failures',
        description: 'Pizza creation failures seen by the service',
        unit: '1',
        type: 'sum',
        valueType: 'int',
        value: state.totals.pizzaFailures,
        attributes: {},
        startTimeMs: state.lastFlushAtMs,
        endTimeMs: nowMs,
      }
    );

    metrics.push(
      {
        name: 'jwt_pizza_service_chaos_failures',
        description: 'Injected order failures caused by chaos mode',
        unit: '1',
        type: 'sum',
        valueType: 'int',
        value: state.totals.chaosFailures,
        attributes: {},
        startTimeMs: state.lastFlushAtMs,
        endTimeMs: nowMs,
      }
    );

    metrics.push(
      {
        name: 'jwt_pizza_service_chaos_state_changes',
        description: 'Chaos mode state changes performed by admins',
        unit: '1',
        type: 'sum',
        valueType: 'int',
        value: state.totals.chaosStateChanges,
        attributes: {},
        startTimeMs: state.lastFlushAtMs,
        endTimeMs: nowMs,
      }
    );

    const latestChaosEvent = state.chaosEvents.at(-1);
    metrics.push(
      {
        name: 'jwt_pizza_service_chaos_enabled',
        description: 'Whether chaos mode is currently enabled',
        unit: '1',
        type: 'gauge',
        valueType: 'double',
        value: latestChaosEvent?.enabled ? 1 : 0,
        attributes: {},
        endTimeMs: nowMs,
      }
    );

    metrics.push(
      {
        name: 'jwt_pizza_service_revenue',
        description: 'Revenue observed by the service',
        unit: 'usd',
        type: 'sum',
        valueType: 'double',
        value: state.totals.revenue,
        attributes: {},
        startTimeMs: state.lastFlushAtMs,
        endTimeMs: nowMs,
      }
    );

    if (pizzaLatencyCount > 0) {
      metrics.push(
        {
          name: 'jwt_pizza_service_pizza_creation_latency_ms',
          description: 'Average pizza creation latency in milliseconds for the current export window',
          unit: 'ms',
          type: 'gauge',
          valueType: 'double',
          value: pizzaLatencyTotalMs / pizzaLatencyCount,
          attributes: {},
          endTimeMs: nowMs,
        }
      );
    }

    if (state.systemSample) {
      metrics.push(
        {
          name: 'jwt_pizza_service_cpu_usage_percent',
          description: 'CPU usage percentage',
          unit: '%',
          type: 'gauge',
          valueType: 'double',
          value: state.systemSample.cpuPercent,
          attributes: {},
          endTimeMs: nowMs,
        }
      );
      metrics.push(
        {
          name: 'jwt_pizza_service_memory_usage_percent',
          description: 'Memory usage percentage',
          unit: '%',
          type: 'gauge',
          valueType: 'double',
          value: state.systemSample.memoryPercent,
          attributes: {},
          endTimeMs: nowMs,
        }
      );
    }

    return metrics;
  }

  function buildMetricPayload(metric) {
    const dataPoint = {
      attributes: createAttributes(metric.attributes),
      timeUnixNano: toUnixNano(metric.endTimeMs),
    };

    if (metric.type === 'sum') {
      dataPoint.startTimeUnixNano = toUnixNano(metric.startTimeMs);
      if (metric.valueType === 'double') {
        dataPoint.asDouble = Number(metric.value);
      } else {
        dataPoint.asInt = String(metric.value);
      }
    } else if (metric.valueType === 'double') {
      dataPoint.asDouble = Number(metric.value);
    } else {
      dataPoint.asInt = String(metric.value);
    }

    const metricBody = {
      name: metric.name,
      description: metric.description,
      unit: metric.unit,
      [metric.type]: {
        dataPoints: [dataPoint],
      },
    };

    if (metric.type === 'sum') {
      metricBody.sum.aggregationTemporality = AGGREGATION_TEMPORALITY_CUMULATIVE;
      metricBody.sum.isMonotonic = true;
    }

    return {
      resourceMetrics: [
        {
          resource: {
            attributes: createResourceAttributes(),
          },
          scopeMetrics: [
            {
              scope: {
                name: 'jwt-pizza-service.metrics',
                version: '1.0.0',
              },
              metrics: [metricBody],
            },
          ],
        },
      ],
    };
  }

  async function sendMetricToGrafana(metric) {
    const payload = buildMetricPayload(metric);
    const body = JSON.stringify(payload);

    const response = await fetch(config.metrics.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${config.metrics.accountId}:${config.metrics.apiKey}`).toString('base64')}`,
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to push ${metric.name}: ${response.status} ${response.statusText} ${errorBody}`);
    }
  }

  function clearFlushedState() {
    state.requestEvents = [];
    state.authEvents = [];
    state.purchaseEvents = [];
    state.chaosEvents = state.chaosEvents.slice(-1);
  }

  async function flush() {
    if (!isEnabled()) {
      return;
    }

    const metrics = buildMetricDefinitions();

    try {
      for (const metric of metrics) {
        await sendMetricToGrafana(metric);
      }

      clearFlushedState();
    } catch (err) {
      console.error('Failed to flush metrics', err.message);
    }
  }

  function startReporter(intervalMs = DEFAULT_FLUSH_INTERVAL_MS) {
    if (!isEnabled()) {
      return;
    }

    state.flushIntervalMs = intervalMs;
    collectSystemMetricsSnapshot();

    if (state.flushTimer) {
      clearInterval(state.flushTimer);
    }

    state.flushTimer = setInterval(() => {
      collectSystemMetricsSnapshot();
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
    trackChaos,
    collectSystemMetrics,
    collectSystemMetricsSnapshot,
    startReporter,
    flush,
    recordIngestionTestMetrics,
    isConfigured,
    isEnabled,
  };
}

module.exports = createMetricsClient();
