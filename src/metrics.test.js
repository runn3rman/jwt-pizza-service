const os = require('os');

function loadMetrics() {
  jest.resetModules();
  return require('./metrics');
}

describe('metrics', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('reports configured and enabled when fetch exists', () => {
    const metrics = loadMetrics();

    expect(metrics.isConfigured()).toBe(true);
    expect(metrics.isEnabled()).toBe(true);
  });

  test('request tracker records normalized routes and flushes HTTP metrics', async () => {
    const metrics = loadMetrics();
    const next = jest.fn();

    const req = {
      method: 'GET',
      path: '/api/order/menu/123',
      originalUrl: '/api/order/menu/123',
      user: { id: 7, email: 'd@test.com' },
    };
    const listeners = {};
    const res = {
      statusCode: 200,
      on: jest.fn((event, handler) => {
        listeners[event] = handler;
      }),
    };

    metrics.requestTracker(req, res, next);
    expect(next).toHaveBeenCalled();
    listeners.finish();

    await metrics.flush();

    const bodies = global.fetch.mock.calls.map((call) => JSON.parse(call[1].body));
    const metricNames = bodies.map((body) => body.resourceMetrics[0].scopeMetrics[0].metrics[0].name);

    expect(metricNames).toContain('jwt_pizza_service_http_requests');
    expect(metricNames).toContain('jwt_pizza_service_http_request_latency_ms');
    expect(metricNames).toContain('jwt_pizza_service_active_users');

    const latencyMetric = bodies.find(
      (body) => body.resourceMetrics[0].scopeMetrics[0].metrics[0].name === 'jwt_pizza_service_http_request_latency_ms'
    );
    const latencyAttributes =
      latencyMetric.resourceMetrics[0].scopeMetrics[0].metrics[0].gauge.dataPoints[0].attributes;
    expect(latencyAttributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'http.route',
          value: { stringValue: '/api/order/menu' },
        }),
      ])
    );
  });

  test('tracks auth, purchases, active users, and system metrics in flushed payloads', async () => {
    jest.spyOn(os, 'loadavg').mockReturnValue([1, 0, 0]);
    jest.spyOn(os, 'cpus').mockReturnValue([{}, {}]);
    jest.spyOn(os, 'totalmem').mockReturnValue(100);
    jest.spyOn(os, 'freemem').mockReturnValue(25);

    const metrics = loadMetrics();

    metrics.trackAuthAttempt({ action: 'login', success: true });
    metrics.trackAuthAttempt({ action: 'login', success: false });
    metrics.trackActiveUser({ id: 99, email: 'u@test.com' });
    metrics.trackPizzaPurchase({ success: true, latencyMs: 150, itemCount: 3, revenue: 12.5 });
    metrics.trackPizzaPurchase({ success: false, latencyMs: 350, itemCount: 0, revenue: 0 });
    metrics.trackChaos({ enabled: true });
    metrics.trackChaos({ enabled: true, injectedFailure: true });
    metrics.collectSystemMetricsSnapshot();

    await metrics.flush();

    const bodies = global.fetch.mock.calls.map((call) => JSON.parse(call[1].body));
    const metricByName = Object.fromEntries(
      bodies.map((body) => [
        body.resourceMetrics[0].scopeMetrics[0].metrics[0].name,
        body.resourceMetrics[0].scopeMetrics[0].metrics[0],
      ])
    );

    expect(metricByName.jwt_pizza_service_auth_attempts.sum).toBeDefined();
    expect(metricByName.jwt_pizza_service_pizzas_sold.sum).toBeDefined();
    expect(metricByName.jwt_pizza_service_pizza_creation_failures.sum).toBeDefined();
    expect(metricByName.jwt_pizza_service_chaos_failures.sum).toBeDefined();
    expect(metricByName.jwt_pizza_service_chaos_state_changes.sum).toBeDefined();
    expect(metricByName.jwt_pizza_service_chaos_enabled.gauge).toBeDefined();
    expect(metricByName.jwt_pizza_service_revenue.sum).toBeDefined();
    expect(metricByName.jwt_pizza_service_cpu_usage_percent.gauge).toBeDefined();
    expect(metricByName.jwt_pizza_service_memory_usage_percent.gauge).toBeDefined();
    expect(metricByName.jwt_pizza_service_pizza_creation_latency_ms.gauge).toBeDefined();

    const revenuePoint = metricByName.jwt_pizza_service_revenue.sum.dataPoints[0];
    expect(revenuePoint.asDouble).toBe(12.5);

    const chaosPoint = metricByName.jwt_pizza_service_chaos_enabled.gauge.dataPoints[0];
    expect(chaosPoint.asDouble).toBe(1);
  });

  test('recordIngestionTestMetrics seeds metrics and flushes successfully', async () => {
    const metrics = loadMetrics();

    expect(metrics.recordIngestionTestMetrics()).toBe(true);

    await metrics.flush();

    const metricNames = global.fetch.mock.calls.map(
      (call) => JSON.parse(call[1].body).resourceMetrics[0].scopeMetrics[0].metrics[0].name
    );
    expect(metricNames).toContain('jwt_pizza_service_http_requests');
    expect(metricNames).toContain('jwt_pizza_service_auth_attempts');
    expect(metricNames).toContain('jwt_pizza_service_cpu_usage_percent');
    expect(metricNames).toContain('jwt_pizza_service_chaos_failures');
  });

  test('flush logs server errors and continues without throwing', async () => {
    const metrics = loadMetrics();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'broken',
    });

    metrics.trackAuthAttempt({ action: 'login', success: true });

    await expect(metrics.flush()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to flush metrics',
      expect.stringContaining('Failed to push jwt_pizza_service_http_requests')
    );
  });

  test('flush logs fetch exceptions and continues without throwing', async () => {
    const metrics = loadMetrics();
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    metrics.trackAuthAttempt({ action: 'login', success: true });

    await expect(metrics.flush()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('Failed to flush metrics', 'network down');
  });

  test('startReporter collects snapshots and flushes on interval', async () => {
    jest.useFakeTimers();
    jest.spyOn(os, 'loadavg').mockReturnValue([1, 0, 0]);
    jest.spyOn(os, 'cpus').mockReturnValue([{}, {}]);
    jest.spyOn(os, 'totalmem').mockReturnValue(100);
    jest.spyOn(os, 'freemem').mockReturnValue(20);

    const metrics = loadMetrics();
    metrics.trackAuthAttempt({ action: 'login', success: true });

    metrics.startReporter(50);
    await jest.advanceTimersByTimeAsync(60);

    expect(global.fetch).toHaveBeenCalled();
    const metricNames = global.fetch.mock.calls.map(
      (call) => JSON.parse(call[1].body).resourceMetrics[0].scopeMetrics[0].metrics[0].name
    );
    expect(metricNames).toContain('jwt_pizza_service_cpu_usage_percent');
    expect(metricNames).toContain('jwt_pizza_service_memory_usage_percent');
  });

  test('methods no-op cleanly when fetch is unavailable', async () => {
    global.fetch = undefined;
    const metrics = loadMetrics();

    expect(metrics.isEnabled()).toBe(false);
    expect(metrics.recordIngestionTestMetrics()).toBe(false);

    const req = { method: 'GET', path: '/', originalUrl: '/' };
    const res = { on: jest.fn(), statusCode: 200 };
    const next = jest.fn();

    metrics.requestTracker(req, res, next);
    metrics.trackAuthAttempt({ action: 'login', success: true });
    metrics.trackActiveUser({ id: 1 });
    metrics.trackPizzaPurchase({ success: true, latencyMs: 1, itemCount: 1, revenue: 1 });
    metrics.collectSystemMetrics({ cpuPercent: 1, memoryPercent: 2 });
    await expect(metrics.flush()).resolves.toBeUndefined();

    expect(next).toHaveBeenCalled();
  });
});
