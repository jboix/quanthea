import { afterAll, describe, expect, test } from 'bun:test';
import type { Frame } from '@quanthea/shared';
import type { AnyConnectorKind } from '../connectors/_shared/index.ts';
import {
  devElasticsearch,
  devOpensearch,
  integrationFor,
} from '../connectors/_shared/test/dev-sources.ts';
import { elasticsearchConnector } from '../connectors/search/elasticsearch-connector.ts';
import { opensearchConnector } from '../connectors/search/opensearch-connector.ts';
import { bindSearch } from './search-binder.ts';
import type { Variables } from './variables.ts';

const live = integrationFor('search');
const timeRange = { from: new Date(Date.now() - 3_600_000), to: new Date() };

/** Each search kind and its dev server, with whether its Painless counts the statements of a loop. */
const servers: {
  name: string;
  kind: AnyConnectorKind;
  source: { config: { url: string }; secret: unknown };
  countsLoops: boolean;
}[] = [
  {
    name: 'Elasticsearch',
    kind: elasticsearchConnector,
    source: devElasticsearch,
    countsLoops: false,
  },
  { name: 'OpenSearch', kind: opensearchConnector, source: devOpensearch, countsLoops: true },
];

/**
 * The player events by name, with the documents of each, and one bucket aggregation over them.
 *
 * @param aggregation - `bucket_script` or `bucket_selector`.
 * @param script - Its script.
 * @returns The search body.
 */
function byEvent(aggregation: string, script: unknown): Record<string, unknown> {
  const bucket = { [aggregation]: { buckets_path: { docs: 'docs' }, script } };
  const docs = { value_count: { field: 'event_name' } };
  return {
    size: 0,
    aggs: { event: { terms: { field: 'event_name', size: 20 }, aggs: { docs, worked: bucket } } },
  };
}

for (const server of servers) {
  describe.skipIf(!live)(`bucket scripts on the dev ${server.name}`, () => {
    const connection = server.kind.open({
      config: server.kind.configSchema.parse(server.source.config),
      secret: server.kind.secretSchema.parse(server.source.secret),
    });
    afterAll(() => connection.close());

    /**
     * Binds a body on a connector that allows bucket scripts, and runs it.
     *
     * @param body - The body.
     * @param variables - The variable values.
     * @returns The columns of its table: `docs` and `worked`, a value per bucket.
     */
    async function run(body: Record<string, unknown>, variables: Variables = {}) {
      const template = { index: 'core_events', body };
      const bound = bindSearch(template, variables, timeRange, { bucketScripts: true });
      const signal = AbortSignal.timeout(20_000);
      const execution = { refId: 'A', signal, timeoutMs: 20_000, maxRows: 5000, timeRange };
      const [frame] = (await connection.execute(bound, execution)) as Frame[];
      const column = (name: string) =>
        frame?.values[frame.fields.findIndex((field) => field.name === name)] ?? [];
      return { docs: column('docs').map(Number), worked: column('worked') };
    }

    /**
     * Sends a script the binder would refuse straight to the server, to record what the server
     * itself answers.
     *
     * @param source - The script text.
     * @returns Why the script failed, or the value it gave each bucket.
     */
    async function unchecked(source: string): Promise<string | unknown[]> {
      const response = await fetch(`${server.source.config.url}/core_events/_search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(byEvent('bucket_script', { source })),
        signal: AbortSignal.timeout(20_000),
      });
      const answer = (await response.json()) as {
        error?: { caused_by?: { reason?: string; caused_by?: { reason?: string } } };
        aggregations?: { event: { buckets: { worked?: { value: unknown } }[] } };
      };
      const failed = answer.error?.caused_by;
      if (failed) return `${failed.reason}: ${failed.caused_by?.reason}`;
      return (answer.aggregations?.event.buckets ?? []).map((bucket) => bucket.worked?.value);
    }

    test('a bucket_script works a number out of the buckets it names', async () => {
      const { docs, worked } = await run(byEvent('bucket_script', 'params.docs * 2 - 1'));
      expect(docs.length).toBeGreaterThan(1);
      expect(worked).toEqual(docs.map((count) => count * 2 - 1));
    });

    test('a bucket_selector keeps the buckets above a number passed in params', async () => {
      const all = (await run(byEvent('bucket_script', 'params.docs'))).docs;
      const min = [...all].sort((a, b) => b - a)[1] ?? 0;
      const script = {
        source: 'params.docs > Double.parseDouble(params.min)',
        params: { min: { $var: 'min' } },
      };
      const variables = { min: { value: String(min) } };
      const kept = (await run(byEvent('bucket_selector', script), variables)).docs;
      expect(kept).toEqual(all.filter((count) => count > min));
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.length).toBeLessThan(all.length);
      const literal = await run(byEvent('bucket_selector', `params.docs > ${min}`));
      expect(literal.docs).toEqual(kept);
    });

    test('a script that fails says why, with nothing of the data', async () => {
      const compared = byEvent('bucket_selector', {
        source: 'params.docs > params.min',
        params: { min: '10' },
      });
      await expect(run(compared)).rejects.toMatchObject({
        code: 'syntax',
        safeMessage:
          'A script of the search has an error. The server says: runtime error: Cannot apply [>] operation to types [java.lang.Double] and [java.lang.String].',
      });
    });

    test('the script has no document to read: the server knows no doc, ctx or _score', async () => {
      for (const symbol of ['doc', 'ctx', '_score', 'state']) {
        const source = symbol === 'doc' ? "doc['event_name'].value" : symbol;
        expect(await unchecked(source)).toBe(`compile error: cannot resolve symbol [${symbol}]`);
        expect(() => run(byEvent('bucket_script', source))).toThrow('one expression');
      }
    });

    test('params holds the named buckets only: no _source, no doc', async () => {
      const source = 'params._source == null && params.doc == null ? 1 : 0';
      const { docs, worked } = await run(byEvent('bucket_script', source));
      expect(docs.length).toBeGreaterThan(1);
      expect(worked).toEqual(docs.map(() => 1));
      expect(await unchecked('params.keySet().size()')).toEqual(docs.map(() => 1));
    });

    // An allocating loop is not run here: it ended both dev servers with an exhausted heap.
    test('a loop is bounded by the server only where its Painless counts statements', async () => {
      const loop = 'long i = 0; for (int j = 0; j < 2000000; j++) { i += j } return i';
      expect(() => run(byEvent('bucket_script', loop))).toThrow('one expression');
      const answer = await unchecked(loop);
      if (!server.countsLoops) return expect(answer).toBeArray();
      expect(answer).toBe(
        'runtime error: The maximum number of statements that can be executed in a loop has been reached.',
      );
    });
  });
}
