import { describe, expect, test } from 'bun:test';
import {
  countNarrowedThreads,
  narrowsAccess,
  restrictedThreads,
  sourceAccessOf,
} from './source-access.ts';
import type { GateSubject } from './subject.ts';

/** A connector at level 4 with one hidden field. */
const subject: GateSubject = {
  id: 'c1',
  name: 'shop',
  kind: 'postgres',
  accessLevel: 4,
  hiddenFields: ['customers.phone'],
  descriptions: {},
};

describe('sourceAccessOf', () => {
  test('records the connector id, the level and fingerprints of the hidden fields', () => {
    const access = sourceAccessOf(subject);
    expect(access.connectorId).toBe('c1');
    expect(access.level).toBe(4);
    expect(access.hidden).toHaveLength(1);
    expect(JSON.stringify(access)).not.toContain('phone');
  });

  test('fingerprints ignore case and spaces around the name', () => {
    const cased = sourceAccessOf({ ...subject, hiddenFields: [' Customers.PHONE '] });
    expect(cased.hidden).toEqual(sourceAccessOf(subject).hidden);
  });
});

describe('narrowsAccess', () => {
  const recorded = sourceAccessOf(subject);

  test('the same settings narrow nothing', () => {
    expect(narrowsAccess(recorded, subject)).toBe(false);
  });

  test('a lower level narrows; a higher one does not', () => {
    expect(narrowsAccess(recorded, { ...subject, accessLevel: 2 })).toBe(true);
    expect(narrowsAccess(sourceAccessOf({ ...subject, accessLevel: 2 }), subject)).toBe(false);
  });

  test('a newly hidden field narrows; showing one again does not', () => {
    const more = { ...subject, hiddenFields: ['customers.phone', 'customers.email'] };
    expect(narrowsAccess(recorded, more)).toBe(true);
    expect(narrowsAccess(recorded, { ...subject, hiddenFields: [] })).toBe(false);
  });
});

describe('the threads an access change affects', () => {
  const rows = [
    { threadId: 't1', access: sourceAccessOf(subject) },
    { threadId: 't1', access: sourceAccessOf({ ...subject, accessLevel: 2 }) },
    { threadId: 't2', access: sourceAccessOf({ ...subject, accessLevel: 2 }) },
    { threadId: 't3', access: sourceAccessOf({ ...subject, id: 'c2' }) },
    { threadId: 't4', access: { connectorId: 'c1', level: 9 } },
  ];

  test('counts each thread once, on the connector only', () => {
    expect(countNarrowedThreads(rows, 'c1', { accessLevel: 3, hiddenFields: [] })).toBe(1);
    expect(countNarrowedThreads(rows, 'c1', { accessLevel: 1, hiddenFields: [] })).toBe(2);
    expect(countNarrowedThreads(rows, 'c1', { accessLevel: 4, hiddenFields: ['x'] })).toBe(2);
    expect(countNarrowedThreads(rows, 'c9', { accessLevel: 1, hiddenFields: [] })).toBe(0);
  });

  test('flags the threads the current settings restrict, ignoring removed connectors', () => {
    const current = new Map([['c1', { accessLevel: 3 as const, hiddenFields: [] }]]);
    expect([...restrictedThreads(rows, (id) => current.get(id))]).toEqual(['t1']);
  });
});
