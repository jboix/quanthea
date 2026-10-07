import { describe, expect, test } from 'bun:test';
import { type DashboardSpec, dashboardSpecSchema } from '@quanthea/shared';
import { type OptionsLoader, resolveVariables } from './variables.ts';

/**
 * A spec with one query-backed variable over Valkey keys.
 *
 * @param variable - What to add to the variable's declaration.
 * @returns The spec.
 */
function specWith(variable: Record<string, unknown> = {}): DashboardSpec {
  return dashboardSpecSchema.parse({
    specVersion: 1,
    title: 'Keys',
    time: { from: 'now-1h', to: 'now' },
    variables: [
      {
        kind: 'query',
        name: 'key',
        source: {
          connector: 'cache',
          language: 'redis',
          command: 'SMEMBERS',
          args: ['dashboards'],
        },
        ...variable,
      },
    ],
    panels: [],
  });
}

/** Lists two options, and counts its calls. */
function loader(): OptionsLoader & { calls: number } {
  const load = Object.assign(
    async () => {
      load.calls += 1;
      return ['stats:web', 'stats:api'];
    },
    { calls: 0 },
  );
  return load;
}

describe('a query-backed variable', () => {
  test('takes a value among its options', async () => {
    const resolved = await resolveVariables(specWith(), { key: 'stats:api' }, loader());
    expect(resolved.key).toEqual({ value: 'stats:api' });
  });

  test('refuses a value that is not one of its options', async () => {
    const pick = (key: string | string[]) =>
      resolveVariables(specWith({ multi: true }), { key }, loader());
    await expect(pick('session:abc')).rejects.toThrow('$key has no option "session:abc".');
    await expect(pick(['stats:web', 'session:abc'])).rejects.toThrow('has no option');
  });

  test('takes its default without loading the options, and when the viewer picks it', async () => {
    const load = loader();
    const spec = specWith({ default: 'stats:old' });
    expect((await resolveVariables(spec, {}, load)).key).toEqual({ value: 'stats:old' });
    expect(load.calls).toBe(0);
    expect((await resolveVariables(spec, { key: 'stats:old' }, load)).key).toEqual({
      value: 'stats:old',
    });
  });

  test('expands "All" to its options', async () => {
    const spec = specWith({ multi: true, includeAll: true });
    expect((await resolveVariables(spec, { key: '$__all' }, loader())).key).toEqual({
      value: ['stats:web', 'stats:api'],
    });
  });
});

describe('a text variable', () => {
  /**
   * A spec with one text variable.
   *
   * @param pattern - Its pattern, if any.
   * @returns The spec.
   */
  function textSpec(pattern?: string): DashboardSpec {
    return dashboardSpecSchema.parse({
      specVersion: 1,
      title: 'Orders',
      time: { from: 'now-1h', to: 'now' },
      variables: [{ kind: 'text', name: 'order', default: 'ab', ...(pattern ? { pattern } : {}) }],
      panels: [],
    });
  }

  test('refuses a value longer than 100 characters', async () => {
    const resolve = (order: string) => resolveVariables(textSpec(), { order }, loader());
    expect((await resolve('x'.repeat(100))).order).toEqual({ value: 'x'.repeat(100) });
    await expect(resolve('x'.repeat(101))).rejects.toThrow('$order is at most 100 characters.');
  });

  test('never runs a pattern that can backtrack for exponential time', async () => {
    const started = performance.now();
    const attack = `${'a'.repeat(60)}!`;
    await expect(resolveVariables(textSpec('(a+)+b'), { order: attack }, loader())).rejects.toThrow(
      '$order has a pattern that cannot be checked safely.',
    );
    expect(performance.now() - started).toBeLessThan(100);
  });
});
