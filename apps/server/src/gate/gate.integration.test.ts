import { afterAll, describe, expect, test } from 'bun:test';
import type { AccessLevel } from '@quanthea/shared';
import {
  devIncidentStart,
  devPostgres,
  integrationEnabled,
} from '../connectors/_shared/test/dev-sources.ts';
import { postgresConnector } from '../connectors/postgres/postgres-connector.ts';
import { createQueryExecutor, type QuerySource } from '../query/executor.ts';
import { createResultCache } from '../query/result-cache.ts';
import { testQueryForModel } from './test-run.ts';

const incident = devIncidentStart();
const timeRange = {
  from: new Date(incident.getTime() - 600_000),
  to: new Date(incident.getTime() + 600_000),
};

describe.skipIf(!integrationEnabled)('the gate over the dev database', () => {
  const instance = postgresConnector.open({
    config: postgresConnector.configSchema.parse(devPostgres.config),
    secret: postgresConnector.secretSchema.parse(devPostgres.secret),
  });
  const source: QuerySource = {
    connectorId: 'pg',
    version: 1,
    language: 'sql',
    instance,
    guardrails: { timeoutMs: 5000, maxRows: 1000, maxRangeDays: 7 },
  };
  // Closing waits up to 5 s for a statement still being cancelled; the hook needs longer.
  afterAll(() => instance.close(), 10_000);

  /**
   * Runs a query through the gate.
   *
   * @param accessLevel - The access level.
   * @param sql - The query.
   * @returns What the model receives, as JSON text.
   */
  const asModel = async (accessLevel: AccessLevel, sql: string): Promise<string> => {
    const subject = {
      name: 'orders',
      kind: 'postgres',
      accessLevel,
      hiddenFields: ['customers.email'],
      descriptions: {},
    };
    const executor = createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 }));
    const request = {
      refId: 'A',
      template: { language: 'sql' as const, sql },
      variables: {},
      timeRange,
    };
    return JSON.stringify(await testQueryForModel(subject, executor, source, request));
  };

  const emails =
    'SELECT c.email, o.total_cents, o.status FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.created_at BETWEEN :__from AND :__to';

  test('level 2 shows the shape of real rows and none of their values', async () => {
    const text = await asModel(2, emails.replace('c.email, ', 'c.name, '));
    expect(text).toContain('"rowCount"');
    expect(text).not.toContain('Customer ');
    expect(text).not.toContain('"paid"');
  });

  test('a hidden column is gone from rows and summaries, even at level 4', async () => {
    const text = await asModel(4, emails);
    expect(text).toContain('"rows"');
    expect(text).not.toContain('@example.com');
  });

  test('renaming a hidden column gets past the name match: the documented limit', async () => {
    const text = await asModel(4, emails.replace('c.email', 'c.email AS contact'));
    expect(text).toContain('@example.com');
  });
});
