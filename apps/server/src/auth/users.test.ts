import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createUserRepository } from '../db/user-repository.ts';
import type { AppError } from '../lib/errors.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

describe('users', () => {
  test('are found by email whatever its case and spacing, and one email is one user', async () => {
    const grace = await services.users.create(
      { email: 'Grace.Hopper@Example.com', name: 'Grace Hopper', role: 'editor' },
      'admin-1',
    );
    expect((await services.users.findByEmail('  grace.hopper@example.COM '))?.id).toBe(grace.id);
    expect(await services.users.findByEmail('someone@example.com')).toBeUndefined();
    const duplicate = await services.users
      .create({ email: 'grace.hopper@example.com', name: 'Other', role: 'viewer' }, 'admin-1')
      .catch((error: AppError) => error);
    expect(duplicate).toMatchObject({ code: 'bad_request' });
    expect(await services.users.get(grace.id)).toMatchObject({
      email: 'Grace.Hopper@Example.com',
      name: 'Grace Hopper',
      role: 'editor',
      hasPassword: false,
      disabled: false,
    });
  });

  test('sign nothing in once disabled', async () => {
    const user = await services.users.create(
      { email: 'linus@example.com', name: 'Linus', role: 'admin' },
      'admin-1',
    );
    expect(await services.users.principalOf(user.id)).toMatchObject({ role: 'admin' });
    createUserRepository(services.database).update(user.id, { disabledAt: 1, updatedAt: 1 });
    expect(await services.users.principalOf(user.id)).toBeNull();
    expect(await services.users.principalOf('nobody')).toBeNull();
  });
});
