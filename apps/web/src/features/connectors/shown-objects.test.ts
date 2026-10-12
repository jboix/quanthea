import { describe, expect, test } from 'bun:test';
import type { ObjectVisibility } from '@quanthea/shared';
import {
  filteredObjects,
  hasSystemObjects,
  isShown,
  lockOf,
  looseEntries,
  matchCount,
  objectsNoun,
  objectUsagePath,
  objectUsageWarning,
  type SchemaObject,
  sameVisibility,
  shownSummary,
  uncountedUsageWarning,
  visibilityOf,
  withName,
  withObject,
  withObjects,
} from './shown-objects.ts';

/**
 * An index of a schema view.
 *
 * @param name - Its name.
 * @param system - Whether it is the server's own.
 * @returns The object.
 */
function index(name: string, system = false): SchemaObject {
  return { name, kind: 'index', system, shown: !system, fields: [] };
}

const objects = [index('logs-app'), index('logs-web'), index('orders'), index('.kibana', true)];

/**
 * A visibility with the defaults filled in.
 *
 * @param partial - What differs from the default.
 * @returns The visibility.
 */
function visibility(partial: Partial<ObjectVisibility> = {}): ObjectVisibility {
  return { showSystem: false, mode: 'except', names: [], ...partial };
}

/**
 * The names a visibility shows of the test objects.
 *
 * @param value - The visibility.
 * @returns The names, in order.
 */
function shownNames(value: ObjectVisibility): string[] {
  return objects.filter((object) => isShown(value, object)).map((object) => object.name);
}

describe('what a visibility shows', () => {
  test('is everything but the system objects by default', () => {
    expect(shownNames(visibility())).toEqual(['logs-app', 'logs-web', 'orders']);
    expect(shownNames(visibility({ showSystem: true }))).toHaveLength(4);
  });

  test('leaves out the names and patterns of a list of hidden ones', () => {
    expect(shownNames(visibility({ names: ['LOGS-*'] }))).toEqual(['orders']);
  });

  test('is only the names and patterns of a list of shown ones, system ones aside', () => {
    const only = visibility({ mode: 'only', names: ['logs-*', '.kibana'] });
    expect(shownNames(only)).toEqual(['logs-app', 'logs-web']);
    expect(shownNames({ ...only, showSystem: true })).toEqual(['logs-app', 'logs-web', '.kibana']);
  });

  test('is counted in a line', () => {
    expect(shownSummary(visibility({ names: ['orders'] }), objects)).toBe(
      'Shows 2 of 4 indices · 1 system hidden',
    );
    expect(shownSummary(visibility({ showSystem: true }), objects)).toBe('Shows 4 of 4 indices');
  });
});

describe('ticking the checklist', () => {
  test('edits a list of hidden names', () => {
    const cleared = withObject(visibility(), 'orders', false);
    expect(cleared.names).toEqual(['orders']);
    expect(withObject(cleared, 'Orders', true).names).toEqual([]);
  });

  test('edits a list of the only names shown', () => {
    const only = visibility({ mode: 'only' });
    const ticked = withObjects(only, ['orders', 'logs-app', 'orders'], true);
    expect(ticked.names).toEqual(['orders', 'logs-app']);
    expect(withObjects(ticked, ['orders'], false).names).toEqual(['logs-app']);
  });

  test('is fixed for a system object while the switch is off, and for a name under a pattern', () => {
    const [app, , orders, kibana] = objects as [
      SchemaObject,
      SchemaObject,
      SchemaObject,
      SchemaObject,
    ];
    const value = visibility({ names: ['logs-*', 'orders'] });
    expect(lockOf(value, kibana)).toEqual({ by: 'system' });
    expect(lockOf(value, app)).toEqual({ by: 'pattern', pattern: 'logs-*' });
    expect(lockOf(value, orders)).toBeUndefined();
    expect(lockOf({ ...value, showSystem: true }, kibana)).toBeUndefined();
  });
});

describe('the entries of a list', () => {
  test('are added once, whatever the case', () => {
    expect(withName(['logs-*'], ' Logs-* ')).toEqual(['logs-*']);
    expect(withName(['logs-*'], ' orders ')).toEqual(['logs-*', 'orders']);
    expect(withName([], '  ')).toEqual([]);
  });

  test('cover a number of objects', () => {
    expect(matchCount('logs-*', objects)).toBe(2);
    expect(matchCount('orders', objects)).toBe(1);
    expect(matchCount('nope', objects)).toBe(0);
  });

  test('show as chips when they are patterns or names the schema lacks', () => {
    expect(looseEntries(['orders', 'logs-*', 'later'], objects)).toEqual(['logs-*', 'later']);
  });

  test('compare without their order', () => {
    const first = visibility({ names: ['a', 'b'] });
    expect(sameVisibility(first, visibility({ names: ['b', 'a'] }))).toBe(true);
    expect(sameVisibility(first, visibility({ names: ['a'] }))).toBe(false);
    expect(sameVisibility(first, { ...first, mode: 'only' })).toBe(false);
    expect(sameVisibility(first, { ...first, showSystem: true })).toBe(false);
  });
});

describe('the checklist', () => {
  test('names its objects by kind', () => {
    expect(objectsNoun(objects)).toBe('indices');
    expect(objectsNoun([...objects, { ...index('t'), kind: 'table' }])).toBe('objects');
    expect(objectsNoun([])).toBe('objects');
  });

  test('filters by every typed word', () => {
    expect(filteredObjects(objects, 'LOGS web').map((object) => object.name)).toEqual(['logs-web']);
    expect(filteredObjects(objects, '  ')).toHaveLength(4);
  });

  test('offers the system switch where sources have objects of their own', () => {
    expect(['sql', 'search', 'mongodb'].every(hasSystemObjects)).toBe(true);
    expect(['promql', 'logql', 'http', 'redis', undefined].some(hasSystemObjects)).toBe(false);
  });
});

describe('the count before hiding an object', () => {
  test('is asked with the visibility in the query, and read back', () => {
    const value = visibility({ showSystem: true, mode: 'only', names: ['logs-*', 'a b'] });
    const path = objectUsagePath('c1', value);
    expect(path.startsWith('/connectors/c1/object-usage?')).toBe(true);
    expect(visibilityOf(new URLSearchParams(path.slice(path.indexOf('?'))))).toEqual(value);
    expect(visibilityOf(new URLSearchParams(''))).toBeUndefined();
    expect(visibilityOf(new URLSearchParams('mode=neither'))).toBeUndefined();
  });

  test('warns with the threads and the pinned dashboards', () => {
    expect(objectUsageWarning({ threads: 3, pinned: 1 })).toStartWith(
      '3 threads and 1 pinned dashboard read an object this change hides.',
    );
    expect(objectUsageWarning({ threads: 1, pinned: 0 })).toStartWith('1 thread reads an object');
    expect(objectUsageWarning({ threads: 0, pinned: 2 })).toStartWith('2 pinned dashboards read');
  });

  test('warns when the count failed', () => {
    expect(uncountedUsageWarning('No connector has this id.')).toContain(
      'could not be counted: No connector has this id. Threads',
    );
  });
});
