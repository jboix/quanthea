import { describe, expect, test } from 'bun:test';
import type { ObjectVisibility } from '@quanthea/shared';
import type { ConnectorInstance, ResolvedObject } from '../../connectors/_shared/index.ts';
import { QueryError } from '../query-error.ts';
import { scopeOf } from './object-scope.ts';
import { narrowSearch } from './search-scope.ts';

/** What the fake server holds. */
const cluster: readonly ResolvedObject[] = [
  { name: '.plugins-ml-config' },
  { name: 'core_events' },
  { name: 'logs-2026.10.11' },
  { name: 'logs-2026.10.12' },
  { name: 'logs-payroll-2026.10.12' },
  { name: 'top_queries-2026.10.12-59492' },
  { name: 'all-logs', members: ['logs-2026.10.12', 'logs-payroll-2026.10.12'] },
  { name: 'app-logs', members: ['logs-2026.10.11', 'logs-2026.10.12'] },
  { name: 'metrics-stream' },
];

/**
 * Whether a glob covers a name, as the fake server expands it.
 *
 * @param pattern - The pattern.
 * @param name - The name.
 * @returns `true` when it does.
 */
function covers(pattern: string, name: string): boolean {
  const source = pattern.split('*').map((part) => part.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&'));
  return new RegExp(`^${source.join('.*')}$`).test(name);
}

/** A connection that resolves expressions against {@link cluster}, without exclusions. */
const instance = {
  resolveObjects: (expression: string) =>
    Promise.resolve(
      cluster.filter(({ name }) => expression.split(',').some((item) => covers(item, name))),
    ),
} as unknown as ConnectorInstance;

/**
 * The index expression a search runs on.
 *
 * @param index - The index expression of the query.
 * @param visibility - The connector's visibility; the default when not given.
 * @param connection - The connection; the fake server when not given.
 * @returns The narrowed expression, or the refusal's message.
 */
async function narrowedIndex(
  index: string,
  visibility: Partial<ObjectVisibility> = {},
  connection: ConnectorInstance = instance,
): Promise<string> {
  const scope = scopeOf({ showSystem: false, mode: 'except', names: [], ...visibility }, 'search');
  const query = { language: 'search', index, body: {} } as const;
  try {
    return (await narrowSearch(scope, query, connection, new AbortController().signal)).index;
  } catch (error) {
    if (error instanceof QueryError) return error.safeMessage;
    throw error;
  }
}

describe('narrowSearch', () => {
  test('excludes the system indices a pattern reaches', async () => {
    expect(await narrowedIndex('*')).toBe('*,-.plugins-ml-config,-top_queries-2026.10.12-59492');
    expect(await narrowedIndex('logs-*')).toBe('logs-*');
    expect(await narrowedIndex('core_events')).toBe('core_events');
  });

  test('excludes what an except list hides, and an alias that reaches it', async () => {
    const hidden = { names: ['logs-payroll-*'] };
    expect(await narrowedIndex('logs-*', hidden)).toBe('logs-*,-logs-payroll-2026.10.12');
    expect(await narrowedIndex('*-logs', hidden)).toBe('*-logs,-all-logs');
    expect(await narrowedIndex('all-logs', hidden)).toContain('does not show "all-logs"');
    expect(await narrowedIndex('app-logs', hidden)).toBe('app-logs');
    expect(await narrowedIndex('logs-payroll-2026.10.12', hidden)).toContain('does not show');
  });

  test('an only list keeps a pattern to its names, and takes an alias by its own name', async () => {
    const only: Partial<ObjectVisibility> = { mode: 'only', names: ['logs-2026*', 'all-logs'] };
    expect(await narrowedIndex('logs-*', only)).toBe('logs-*,-logs-payroll-2026.10.12');
    expect(await narrowedIndex('all-logs', only)).toBe('all-logs');
    expect(await narrowedIndex('core_*', only)).toContain('reaches nothing this connector shows');
  });

  test('shows the system indices when the connector says so', async () => {
    expect(await narrowedIndex('*', { showSystem: true })).toBe('*');
    expect(await narrowedIndex('*', { showSystem: true, names: ['core_events'] })).toBe(
      '*,-core_events',
    );
  });

  test('refuses a pattern that reaches more hidden indices than it can exclude', async () => {
    const many = Array.from({ length: 60 }, (_item, index) => ({ name: `.internal-${index}` }));
    const wide = {
      resolveObjects: () => Promise.resolve([...many, { name: 'core_events' }]),
    } as unknown as ConnectorInstance;
    expect(await narrowedIndex('*', {}, wide)).toContain('reaches 60 indices');
  });

  test('refuses a pattern on a kind that cannot resolve it', async () => {
    const plain = {} as ConnectorInstance;
    expect(await narrowedIndex('logs-*', {}, plain)).toContain('cannot resolve a pattern');
    expect(await narrowedIndex('core_events', {}, plain)).toBe('core_events');
  });
});
