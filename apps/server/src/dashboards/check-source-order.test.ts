import { describe, expect, test } from 'bun:test';
import type { ConnectorLookup } from './check-queries.ts';
import { validateSpec } from './validate.ts';

const guardrails = { timeoutMs: 10_000, maxRows: 1000, maxRangeDays: 90 };

/** One connector of each language whose binder reads variables its own way. */
const lookup: ConnectorLookup = (name) =>
  ({
    prom: { language: 'promql', guardrails },
    shop: { language: 'sql', guardrails },
    logs: { language: 'search', guardrails },
  })[name] as ReturnType<ConnectorLookup>;

const now = Date.parse('2026-09-28T12:00:00Z');

/** The sources of a variable `pod` that read the variable `env`, one per language. */
const sources = {
  promql: { connector: 'prom', language: 'promql', expr: 'label_values(up{env="$env"}, pod)' },
  sql: { connector: 'shop', language: 'sql', sql: 'SELECT name FROM pods WHERE env = :env' },
  search: {
    connector: 'logs',
    language: 'search',
    index: 'pods',
    body: { size: 10, query: { term: { env: { $var: 'env' } } } },
  },
};

/** Where each language's source keeps its text. */
const textKeys = { promql: 'expr', sql: 'sql', search: 'body' };

/**
 * A spec whose variable `pod` reads `env`, with `pod` declared first or last.
 *
 * @param language - The language of the source of `pod`.
 * @param place - Whether `pod` comes before `env` or after it.
 * @param extra - More of the variable `pod`, such as a default.
 * @returns The spec, as JSON.
 */
function specWith(language: keyof typeof sources, place: 'first' | 'last', extra: object = {}) {
  const env = { kind: 'custom', name: 'env', options: ['prod', 'staging'], default: 'prod' };
  const pod = { kind: 'query', name: 'pod', source: sources[language], ...extra };
  const query = { refId: 'A', connector: 'prom', language: 'promql', expr: 'up{pod="$pod"}' };
  const view = { kind: 'stat', ref: 'A', reduce: 'max', format: { $fmt: 'number' } };
  const grid = { x: 0, y: 0, w: 4, h: 3 };
  return {
    specVersion: 1,
    title: 'Pods',
    time: { from: 'now-1h', to: 'now' },
    variables: place === 'first' ? [pod, env] : [env, pod],
    panels: [{ id: 'up', title: 'Up', grid, queries: [query], view }],
  };
}

/**
 * The issues validation finds.
 *
 * @param spec - The spec.
 * @param writing - Whether the spec is being written.
 * @returns The issues, as `path: message` lines.
 */
function issuesOf(spec: unknown, writing: boolean): string[] {
  const result = validateSpec(spec, { lookup, now, writing });
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

describe('the order of the variables a source uses', () => {
  for (const language of ['promql', 'sql', 'search'] as const) {
    test(`is checked for a ${language} source when the spec is written`, () => {
      expect(issuesOf(specWith(language, 'last'), true)).toEqual([]);
      expect(issuesOf(specWith(language, 'first'), true)).toEqual([
        `variables[0].source.${textKeys[language]}: The source of "pod" uses "env", which is declared after it. A source may use only the variables declared before it. Declare "env" before "pod".`,
      ]);
    });
  }

  test('is not checked for a stored spec, which draws with the default of its variable', () => {
    const stored = specWith('promql', 'first', { default: 'pod-1' });
    expect(issuesOf(stored, false)).toEqual([]);
    expect(issuesOf(stored, true)).toHaveLength(1);
    expect(validateSpec(stored, { lookup, now }).ok).toBe(true);
  });
});
