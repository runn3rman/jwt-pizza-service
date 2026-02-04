const { DB, Role } = require('./database');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

test('token signature and offset helpers', () => {
  expect(DB.getTokenSignature('a.b.c')).toBe('c');
  expect(DB.getTokenSignature('abc')).toBe('');
  expect(DB.getOffset(2, 10)).toBe(10);
});

test('add/get/update user and auth flow', async () => {
  const user = {
    name: `user-${randomName()}`,
    email: `${randomName()}@test.com`,
    password: 'pass',
    roles: [{ role: Role.Diner }],
  };
  const created = await DB.addUser(user);
  expect(created.id).toBeDefined();

  const fetched = await DB.getUser(user.email, user.password);
  expect(fetched.email).toBe(user.email);
  expect(fetched.roles[0].role).toBe(Role.Diner);

  const updatedEmail = `${randomName()}@test.com`;
  const updated = await DB.updateUser(created.id, `updated-${randomName()}`, updatedEmail, 'pass2');
  expect(updated.email).toBe(updatedEmail);

  const token = 'a.b.c';
  await DB.loginUser(created.id, token);
  await expect(DB.isLoggedIn(token)).resolves.toBe(true);
  await DB.logoutUser(token);
  await expect(DB.isLoggedIn(token)).resolves.toBe(false);
});

test('getID error path', async () => {
  const connection = await DB.getConnection();
  try {
    await expect(DB.getID(connection, 'id', -1, 'menu')).rejects.toThrow('No ID found');
  } finally {
    connection.end();
  }
});
