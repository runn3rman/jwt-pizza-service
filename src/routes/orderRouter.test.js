const request = require('supertest');
const app = require('../service');
const { DB, Role } = require('../database/database');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function registerUser() {
  const user = {
    name: `user-${randomName()}`,
    email: `${randomName()}@test.com`,
    password: 'a',
  };
  const res = await request(app).post('/api/auth').send(user);
  return { ...user, id: res.body.user.id, token: res.body.token };
}

async function createAdminUser() {
  const admin = {
    name: `admin-${randomName()}`,
    email: `${randomName()}@admin.com`,
    password: 'adminpass',
    roles: [{ role: Role.Admin }],
  };
  const created = await DB.addUser(admin);
  return { ...created, password: admin.password };
}

async function loginUser(email, password) {
  const res = await request(app).put('/api/auth').send({ email, password });
  return res.body.token;
}

let adminToken;
let diner;
let franchiseId;
let storeId;
let menuId;

beforeAll(async () => {
  const adminUser = await createAdminUser();
  adminToken = await loginUser(adminUser.email, adminUser.password);
  diner = await registerUser();

  const franchiseRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `franchise-${randomName()}`, admins: [{ email: diner.email }] });
  franchiseId = franchiseRes.body.id;

  const storeRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `store-${randomName()}` });
  storeId = storeRes.body.id;

  const menuItem = { title: `pizza-${randomName()}`, description: 'test', image: 'pizza.png', price: 0.01 };
  const addRes = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminToken}`).send(menuItem);
  const added = addRes.body.find((item) => item.title === menuItem.title);
  menuId = added.id;
});

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = undefined;
});

test('get menu', async () => {
  const res = await request(app).get('/api/order/menu');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('admin can add menu item; non-admin cannot', async () => {
  const menuItem = { title: `pizza-${randomName()}`, description: 'test', image: 'pizza.png', price: 0.01 };
  const addRes = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(menuItem);
  expect(addRes.status).toBe(200);
  const added = addRes.body.find((item) => item.title === menuItem.title);
  expect(added).toBeDefined();

  const unauthorizedRes = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${diner.token}`)
    .send({ title: `nope-${randomName()}`, description: 'nope', image: 'x.png', price: 0.01 });
  expect(unauthorizedRes.status).toBe(403);
});

test('create order success and failure paths', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ reportUrl: 'https://example.com/report', jwt: 'factory-jwt' }),
  });

  const orderRes = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${diner.token}`)
    .send({ franchiseId, storeId, items: [{ menuId, description: 'test', price: 0.01 }] });
  expect(orderRes.status).toBe(200);
  expect(orderRes.body.order.id).toBeDefined();
  expect(orderRes.body.jwt).toBeDefined();

  global.fetch.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ reportUrl: 'https://example.com/report' }),
  });

  const failRes = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${diner.token}`)
    .send({ franchiseId, storeId, items: [{ menuId, description: 'test', price: 0.01 }] });
  expect(failRes.status).toBe(500);
});

test('get orders for diner', async () => {
  const res = await request(app).get('/api/order').set('Authorization', `Bearer ${diner.token}`);
  expect(res.status).toBe(200);
  expect(res.body.dinerId).toBe(diner.id);
});
