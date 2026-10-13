import { describe, expect, test } from 'bun:test';
import { writeAccessOf, writeHeadline } from './write-access.ts';

/** A test that passed. */
const passed = { ok: true, latencyMs: 12, message: 'PostgreSQL 18.6.' };

describe('writeAccessOf', () => {
  test('warns when the credentials can write, with what was found and the account to create', () => {
    const report = {
      ...passed,
      readOnly: false,
      canDo: ['It is a superuser.'],
      readOnlySetup: 'CREATE ROLE quanthea_read;\n',
    };
    expect(writeAccessOf(report)).toEqual({
      state: 'can-write',
      canDo: ['It is a superuser.'],
      setup: 'CREATE ROLE quanthea_read;',
    });
  });

  test('warns also when the kind says no more than that the credentials can write', () => {
    expect(writeAccessOf({ ...passed, readOnly: false })).toEqual({
      state: 'can-write',
      canDo: [],
      setup: undefined,
    });
  });

  test('says unknown, never read-only, when the source cannot tell', () => {
    expect(writeAccessOf({ ...passed, readOnly: null, readOnlySetup: '' })).toEqual({
      state: 'unknown',
      setup: undefined,
    });
  });

  test('stays quiet for credentials that only read, a failed test and no test yet', () => {
    expect(writeAccessOf({ ...passed, readOnly: true })).toEqual({ state: 'quiet' });
    expect(writeAccessOf({ ...passed, ok: false, readOnly: false })).toEqual({ state: 'quiet' });
    expect(writeAccessOf(undefined)).toEqual({ state: 'quiet' });
  });

  test('says it plainly', () => {
    expect(writeHeadline).toBe('These credentials can write. You may want to look at that.');
  });
});
