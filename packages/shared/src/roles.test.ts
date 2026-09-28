import { describe, expect, test } from 'bun:test';
import { hasRole, type Role, roles } from './roles.ts';

describe('hasRole', () => {
  const expected: Record<Role, Record<Role, boolean>> = {
    viewer: { viewer: true, editor: false, admin: false },
    editor: { viewer: true, editor: true, admin: false },
    admin: { viewer: true, editor: true, admin: true },
  };

  for (const actual of roles) {
    for (const minimum of roles) {
      test(`${actual} meets ${minimum}: ${expected[actual][minimum]}`, () => {
        expect(hasRole(actual, minimum)).toBe(expected[actual][minimum]);
      });
    }
  }
});
