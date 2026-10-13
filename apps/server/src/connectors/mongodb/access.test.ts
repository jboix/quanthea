import { describe, expect, test } from 'bun:test';
import { anonymousAccess, readOnlyUser, userAccess, writeFindings } from './access.ts';

/** The privileges of the built-in `read` role on a database. */
const read = [
  { resource: { db: 'shop', collection: '' }, actions: ['find', 'listCollections', 'collStats'] },
];

describe('what a MongoDB user may do', () => {
  test('a user with the read role is read-only', () => {
    expect(userAccess('dash_ro', read, 'shop')).toEqual({
      readOnly: true,
      canDo: [],
      sentence: 'User dash_ro cannot write.',
    });
  });

  test('names the write actions in the database, whatever resource gives them', () => {
    for (const resource of [{ db: 'shop' }, { db: '' }, { anyResource: true }, { cluster: true }]) {
      const privileges = [...read, { resource, actions: ['find', 'insert', 'remove'] }];
      expect(userAccess('app', privileges, 'shop')).toMatchObject({
        readOnly: false,
        canDo: ['It can insert, remove in the database shop.'],
      });
    }
  });

  test('a user that writes only elsewhere can still do more than read', () => {
    const privileges = [
      ...read,
      { resource: { db: 'audit' }, actions: ['update', 'dropDatabase'] },
    ];
    expect(writeFindings(privileges, 'shop')).toEqual(['It can write in other databases: audit.']);
    expect(userAccess('app', privileges, 'shop').readOnly).toBe(false);
  });

  test('counts schema, user and server actions as more than reading', () => {
    for (const action of ['createIndex', 'collMod', 'createUser', 'grantRole', 'anyAction']) {
      const privileges = [{ resource: { db: 'shop' }, actions: [action] }];
      expect(userAccess('app', privileges, 'shop').readOnly).toBe(false);
    }
  });

  test('a server that asks for no sign-in can be written by whoever reaches it', () => {
    const open = anonymousAccess(true);
    expect(open.readOnly).toBe(false);
    expect(open.canDo[0]).toContain('asks for no sign-in');
  });

  test('a connection without a user that the server refuses is unknown, never read-only', () => {
    expect(anonymousAccess(false)).toMatchObject({ readOnly: null, canDo: [] });
  });

  test('gives the user to create, with the read role only', () => {
    const setup = readOnlyUser('shop "eu"');
    expect(setup).toContain('db.getSiblingDB("shop \\"eu\\"").createUser(');
    expect(setup).toContain('roles: [{ role: "read", db: "shop \\"eu\\"" }]');
    expect(setup).not.toContain('readWrite');
  });
});
