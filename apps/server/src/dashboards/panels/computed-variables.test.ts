import { describe, expect, test } from 'bun:test';
import { applyEdit } from './edit.ts';
import { edit, firstBuild, issuesOf, specOf } from './fixtures.ts';

/** The services that failed lately, read from the shop's deploys. */
const failing = {
  kind: 'computed',
  name: 'failing',
  source: {
    connector: 'shop',
    language: 'sql',
    sql: 'SELECT service FROM deploys WHERE failed AND deployed_at > :__from',
  },
  multi: true,
};

describe('a computed variable written by the agent', () => {
  test('joins the variables as written, and the spec checks its source', () => {
    const variables = [...(firstBuild.variables ?? []), failing];
    const spec = specOf(undefined, edit({ ...firstBuild, variables }));
    expect(spec.variables.at(-1)).toEqual(failing as never);
    expect(issuesOf(spec)).toEqual([]);
  });

  test('is refused with the form it misses when its source fits no query form', () => {
    const wrong = { ...failing, source: { connector: 'shop', language: 'sql', query: 'SELECT 1' } };
    const variables = [...(firstBuild.variables ?? []), wrong];
    expect(() => applyEdit(undefined, edit({ ...firstBuild, variables }))).toThrow(
      '$failing does not fit its form:',
    );
  });
});
