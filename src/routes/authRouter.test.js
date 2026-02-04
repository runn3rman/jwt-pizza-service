const request = require('supertest');
const app = require('../service');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

const testUser = {
  name: `diner-${randomName()}`,
  email: `${randomName()}@test.com`,
  password: 'a',
};
let authToken;
let userId;

beforeAll(async () => {
  const registerRes = await request(app).post('/api/auth').send(testUser);
  authToken = registerRes.body.token;
  userId = registerRes.body.user.id;
});

test('register requires all fields', async () => {
  const res = await request(app).post('/api/auth').send({ email: 'x@test.com', password: 'a' });
  expect(res.status).toBe(400);
});

test('login returns jwt and user', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { id: userId, name: testUser.name, email: testUser.email, roles: [{ role: 'diner' }] };
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('logout clears auth token', async () => {
  const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${authToken}`);
  expect(logoutRes.status).toBe(200);

  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${authToken}`);
  expect(meRes.status).toBe(401);
});
