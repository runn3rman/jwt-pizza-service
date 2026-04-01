const app = require('./service.js');
const metrics = require('./metrics.js');
const logger = require('./logger.js');

const port = process.argv[2] || 3000;
metrics.startReporter();
logger.registerProcessHandlers();
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
