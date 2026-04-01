const express = require('express');
const logger = require('./logger');

const app = express();

app.use(express.json());
app.use(logger.httpLogger);

app.get('/hello/:name', (req, res) => {
  res.send({ hello: req.params.name });
});

app.post('/hello', (req, res) => {
  res.send({ hello: req.body.name });
});

app.get('/error', () => {
  throw new Error('Trouble in river city!');
});

app.use((req, res) => {
  res.status(404).send({ msg: 'Not Found' });
});

app.use((err, req, res, next) => {
  void err;
  void next;
  res.status(500).send({ msg: 'Internal Server Error' });
});

app.listen(3000, () => {
  console.log('Listening on port 3000');
});
