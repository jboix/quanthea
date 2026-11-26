import { describe, expect, test } from 'bun:test';
import { hasRole, type Role, roles, weakerRole } from './roles.ts';

describe('hasRole', () => {
  const expected: Record<Role, Record<Role, boolean>> = {
    viewer: { viewer: true, analyst: false, editor: false, admin: false },
    analyst: { viewer: true, analyst: true, editor: false, admin: false },
    editor: { viewer: true, analyst: true, editor: true, admin: false },
    admin: { viewer: true, analyst: true, editor: true, admin: true },
  };

  for (const actual of roles) {
    for (const minimum of roles) {
      test(`${actual} meets ${minimum}: ${expected[actual][minimum]}`, () => {
        expect(hasRole(actual, minimum)).toBe(expected[actual][minimum]);
      });
    }
  }

  test('ranks the roles viewer, analyst, editor, admin', () => {
    expect(roles).toEqual(['viewer', 'analyst', 'editor', 'admin']);
  });
});

describe('weakerRole', () => {
  test('gives whichever grants less, in either order', () => {
    expect(weakerRole('admin', 'viewer')).toBe('viewer');
    expect(weakerRole('analyst', 'editor')).toBe('analyst');
    expect(weakerRole('editor', 'editor')).toBe('editor');
  });
});
