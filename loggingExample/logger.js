const config = require('./config');

class Logger {
  httpLogger = (req, res, next) => {
    const send = res.send.bind(res);

    res.send = (resBody) => {
      const logData = {
        authorized: !!req.headers.authorization,
        path: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        reqBody: JSON.stringify(req.body),
        resBody: JSON.stringify(resBody),
      };
      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, 'http', logData);
      return send(resBody);
    };

    next();
  };

  log(level, type, logData) {
    const labels = { component: config.source, level, type };
    const values = [[this.nowString(), this.sanitize(logData)]];
    const logEvent = { streams: [{ stream: labels, values }] };

    this.sendLogToGrafana(logEvent);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    return (Date.now() * 1000000).toString();
  }

  sanitize(logData) {
    const serialized = JSON.stringify(logData);
    return serialized.replace(/\\"password\\":\s*\\"[^"]*\\"/g, '\\"password\\":\\"*****\\"');
  }

  sendLogToGrafana(event) {
    const body = JSON.stringify(event);
    const auth = Buffer.from(`${config.accountId}:${config.apiKey}`).toString('base64');

    fetch(config.endpointUrl, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
    }).then((res) => {
      if (!res.ok) {
        console.log(`Failed to send log to Grafana: ${res.status} ${res.statusText}`);
      }
    }).catch(() => {
      console.log('Failed to send log to Grafana');
    });
  }
}

module.exports = new Logger();
