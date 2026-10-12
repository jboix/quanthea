/**
 * Searches through the executor on the dev Elasticsearch and OpenSearch, with connectors that hide
 * indices: what a pattern reaches is what the connector shows, on the server's own answer.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ObjectVisibility } from '@quanthea/shared';
import type { AnyConnectorKind, ConnectorInstance } from '../../connectors/_shared/index.ts';
import {
  devElasticsearch,
  devIncidentStart,
  devOpensearch,
  integrationFor,
} from '../../connectors/_shared/test/dev-sources.ts';
import { elasticsearchConnector } from '../../connectors/search/elasticsearch-connector.ts';
import { opensearchConnector } from '../../connectors/search/opensearch-connector.ts';
import { createQueryExecutor } from '../executor.ts';
import { QueryError } from '../query-error.ts';
import { createResultCache } from '../result-cache.ts';
import { scopeOf } from './object-scope.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 30 * 60_000),
  to: new Date(incident.getTime() + 60 * 60_000),
};
const guardrails = { timeoutMs: 20_000, maxRows: 5000, maxRangeDays: 7 };
const executor = createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 }));

/** Counts the runs. */
const runs = {
  count: 0,
  /**
   * The number of the next run.
   *
   * @returns The number.
   */
  next(): number {
    this.count += 1;
    return this.count;
  },
};

/** An alias over the player events, made for this run and removed after it. */
const alias = `quanthea-scope-test-${process.pid}`;

/** Each kind and its dev server. */
const servers: {
  name: string;
  kind: AnyConnectorKind;
  source: { config: unknown; secret: unknown };
}[] = [
  { name: 'Elasticsearch', kind: elasticsearchConnector, source: devElasticsearch },
  { name: 'OpenSearch', kind: opensearchConnector, source: devOpensearch },
];

/**
 * Adds or removes the test alias on a dev server.
 *
 * @param url - The server's URL.
 * @param action - `add` or `remove`.
 * @returns When the server answered.
 */
async function changeAlias(url: string, action: 'add' | 'remove'): Promise<void> {
  await fetch(`${url}/_aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actions: [{ [action]: { index: 'core_events', alias } }] }),
  });
}

describe.skipIf(!integrationFor('search')).each(servers)(
  'the indices a $name connector shows',
  ({ kind, source }) => {
    const url = (source.config as { url: string }).url;
    let instance: ConnectorInstance;

    beforeAll(async () => {
      instance = kind.open({
        config: kind.configSchema.parse(source.config),
        secret: kind.secretSchema.parse(source.secret),
      });
      await changeAlias(url, 'add');
    });

    afterAll(async () => {
      await changeAlias(url, 'remove');
      await instance.close();
    });

    /**
     * Runs a count of documents by index and reads which indices answered.
     *
     * @param index - The index expression.
     * @param visibility - What differs from the default visibility.
     * @returns The indices that held documents, sorted, and the expression that ran.
     */
    async function indicesOf(index: string, visibility: Partial<ObjectVisibility> = {}) {
      const scope = scopeOf(
        { showSystem: false, mode: 'except', names: [], ...visibility },
        'search',
      );
      const querySource = {
        connectorId: 'search',
        // A connector's version changes with its settings, so no run reads another's cache.
        version: runs.next(),
        language: 'search' as const,
        instance,
        guardrails,
        scope,
      };
      const body = { size: 0, aggs: { by_index: { terms: { field: '_index', size: 100 } } } };
      const result = await executor.run(querySource, {
        refId: 'A',
        template: { language: 'search', index, body },
        variables: {},
        timeRange,
      });
      const names = (result.frames[0]?.values[0] ?? []).map(String).sort();
      return { names, ran: result.bound.language === 'search' ? result.bound.index : '' };
    }

    /**
     * Why a search is refused.
     *
     * @param index - The index expression.
     * @param visibility - What differs from the default visibility.
     * @returns The refusal's message.
     */
    async function refusal(index: string, visibility: Partial<ObjectVisibility>): Promise<string> {
      const failure = await indicesOf(index, visibility).catch((error: unknown) => error);
      if (failure instanceof QueryError) return `${failure.code}: ${failure.safeMessage}`;
      throw new Error('Expected the search to be refused.');
    }

    test('resolves an expression to its indices and aliases', async () => {
      const resolved = await instance.resolveObjects?.('*', AbortSignal.timeout(10_000));
      const names = (resolved ?? []).map((target) => target.name);
      expect(names).toEqual(expect.arrayContaining(['core_events', alias]));
      expect(resolved?.find((target) => target.name === alias)?.members).toEqual(['core_events']);
      expect(names.some((name) => name.startsWith('logs-'))).toBe(true);
    });

    test('a star reaches no index the server keeps for itself', async () => {
      const { names } = await indicesOf('*');
      expect(names).toContain('core_events');
      expect(
        names.filter((name) => name.startsWith('.') || name.startsWith('top_queries-')),
      ).toEqual([]);
    });

    test('a pattern skips a hidden index, and the alias that reaches it', async () => {
      const hidden = { names: ['core_events'] };
      const { names, ran } = await indicesOf('*', hidden);
      expect(names).not.toContain('core_events');
      expect(names.some((name) => name.startsWith('logs-'))).toBe(true);
      expect(ran).toContain(`-${alias}`);
      expect(await refusal('core_events', hidden)).toContain('does not show "core_events"');
      expect(await refusal(alias, hidden)).toContain(`does not show "${alias}"`);
    });

    test('an only list keeps a pattern to its names', async () => {
      const only: Partial<ObjectVisibility> = { mode: 'only', names: ['core_events'] };
      expect((await indicesOf('*', only)).names).toEqual(['core_events']);
      expect((await indicesOf('core_*', only)).names).toEqual(['core_events']);
      expect(await refusal('logs-*', only)).toContain('reaches nothing this connector shows');
      const aliased: Partial<ObjectVisibility> = { mode: 'only', names: [alias] };
      expect((await indicesOf(alias, aliased)).names).toEqual(['core_events']);
    });
  },
);
