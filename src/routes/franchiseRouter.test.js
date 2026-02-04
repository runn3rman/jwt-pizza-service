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
let franchiseAdmin;
let otherUser;
let franchiseId;
let storeId;

beforeAll(async () => {
  const adminUser = await createAdminUser();
  adminToken = await loginUser(adminUser.email, adminUser.password);
  franchiseAdmin = await registerUser();
  otherUser = await registerUser();
});

test('admin can create a franchise', async () => {
  const franchise = { name: `franchise-${randomName()}`, admins: [{ email: franchiseAdmin.email }] };
  const res = await request(app).post('/api/franchise').set('Authorization', `Bearer ${adminToken}`).send(franchise);
  expect(res.status).toBe(200);
  expect(res.body.id).toBeDefined();
  franchiseId = res.body.id;
});

test('non-admin cannot create a franchise', async () => {
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${franchiseAdmin.token}`)
    .send({ name: `franchise-${randomName()}`, admins: [{ email: franchiseAdmin.email }] });
  expect(res.status).toBe(403);
});

test('list franchises and user franchises', async () => {
  const listRes = await request(app).get('/api/franchise');
  expect(listRes.status).toBe(200);
  expect(Array.isArray(listRes.body.franchises)).toBe(true);

  const userFranchisesRes = await request(app)
    .get(`/api/franchise/${franchiseAdmin.id}`)
    .set('Authorization', `Bearer ${franchiseAdmin.token}`);
  expect(userFranchisesRes.status).toBe(200);
  expect(Array.isArray(userFranchisesRes.body)).toBe(true);
});

test('admin can create and delete a store', async () => {
  const createRes = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `store-${randomName()}` });
  expect(createRes.status).toBe(200);
  storeId = createRes.body.id;

  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchiseId}/store/${storeId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(deleteRes.status).toBe(200);
});

test('non-admin non-franchise-admin cannot create store', async () => {
  const res = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${otherUser.token}`)
    .send({ name: `store-${randomName()}` });
  expect(res.status).toBe(403);
});

test('delete franchise', async () => {
  const res = await request(app).delete(`/api/franchise/${franchiseId}`);
  expect(res.status).toBe(200);
});
