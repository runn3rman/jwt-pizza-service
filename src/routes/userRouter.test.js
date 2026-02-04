const request = require('supertest');
const app = require('../service');
const { DB, Role } = require('../database/database');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function registerUser() {
  const user = {
    name: `diner-${randomName()}`,
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

let user;
let otherUser;
let adminToken;

beforeAll(async () => {
  user = await registerUser();
  otherUser = await registerUser();
  const adminUser = await createAdminUser();
  adminToken = await loginUser(adminUser.email, adminUser.password);
});

test('get current user', async () => {
  const res = await request(app).get('/api/user/me').set('Authorization', `Bearer ${user.token}`);
  expect(res.status).toBe(200);
  expect(res.body.email).toBe(user.email);
});

test('user can update own profile', async () => {
  const newName = `updated-${randomName()}`;
  const newEmail = `${randomName()}@test.com`;
  const res = await request(app)
    .put(`/api/user/${user.id}`)
    .set('Authorization', `Bearer ${user.token}`)
    .send({ name: newName, email: newEmail });

  expect(res.status).toBe(200);
  expect(res.body.user.name).toBe(newName);
  expect(res.body.user.email).toBe(newEmail);
});

test('non-admin cannot update other users', async () => {
  const res = await request(app)
    .put(`/api/user/${user.id}`)
    .set('Authorization', `Bearer ${otherUser.token}`)
    .send({ name: `nope-${randomName()}` });

  expect(res.status).toBe(403);
});

test('admin can update any user', async () => {
  const res = await request(app)
    .put(`/api/user/${user.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `admin-update-${randomName()}`, email: `${randomName()}@test.com` });

  expect(res.status).toBe(200);
});
