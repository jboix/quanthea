/**
 * Testing a connector kind, for built-in kinds and plugins alike: a kit to call a plugin with, and
 * the conformance suite every kind runs, `testConnectorConformance(kind, fixture)` in the kind's
 * test file. The static checks always run; the live checks need a source to talk to.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { frameProblems } from '@quanthea/shared';
import { kindProblems } from './checks.ts';
import type { ConnectorInstance, ConnectorKind } from './connector-kind.ts';
import { ConnectorError } from './errors.ts';
import { hostKit } from './host.ts';
import type { ConnectorKit } from './kit.ts';
import type { BoundQuery, ExecutionContext, TimeRange } from './queries.ts';
import type { FieldReference } from './schema.ts';

/** What the suite needs to exercise a kind. */
export interface ConformanceFixture {
  /** A valid configuration, before parsing. */
  readonly config: unknown;
  /** Valid credentials, before parsing. */
  readonly secret: unknown;
  /** A query that returns at least two rows over {@link ConformanceFixture.timeRange}. */
  readonly query: BoundQuery;
  /** A query the source rejects, to check the error. */
  readonly invalidQuery: BoundQuery;
  /** A field with at least two distinct values. */
  readonly sampleField: FieldReference;
  /** The time range to query. */
  readonly timeRange: TimeRange;
  /** Whether a source is available. Without one, only the static checks run. */
  readonly live: boolean;
  /** Names the source in the test titles, when a kind runs against several. */
  readonly label?: string;
}

/**
 * The kit to call a plugin with in its tests: the same functions quanthea passes at load.
 *
 * @returns The kit.
 */
export function createTestKit(): ConnectorKit {
  return hostKit;
}

/**
 * Builds an execution context for the suite.
 *
 * @param fixture - The fixture, for the time range.
 * @param overrides - Fields to replace.
 * @returns The context.
 */
function contextFor(
  fixture: ConformanceFixture,
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    refId: 'A',
    signal: AbortSignal.timeout(10_000),
    timeoutMs: 10_000,
    maxRows: 1000,
    timeRange: fixture.timeRange,
    ...overrides,
  };
}

/**
 * Checks what a kind declares, without a source.
 *
 * @param kind - The connector kind.
 * @param fixture - The fixture.
 */
function testDeclaration(kind: ConnectorKind, fixture: ConformanceFixture): void {
  test('passes the static checks the loader runs on every plugin', () => {
    expect(kindProblems(kind)).toEqual([]);
  });

  test('accepts the fixture configuration and credentials', () => {
    expect(kind.configSchema.safeParse(fixture.config).success).toBe(true);
    expect(kind.secretSchema.safeParse(fixture.secret).success).toBe(true);
  });
}

/**
 * Checks a live connection: health, schema, samples.
 *
 * @param connection - Returns the open connection.
 * @param fixture - The fixture.
 */
function testReading(connection: () => ConnectorInstance, fixture: ConformanceFixture): void {
  test('test() reports a healthy source', async () => {
    const report = await connection().test(AbortSignal.timeout(10_000));
    expect(report.ok).toBe(true);
    expect(report.latencyMs).toBeGreaterThanOrEqual(0);
    expect([true, false, null]).toContain(report.readOnly);
  });

  test('describe() lists entities with unique names and their fields', async () => {
    const snapshot = await connection().describe(AbortSignal.timeout(10_000));
    const names = snapshot.entities.map((entity) => entity.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(snapshot.entities.every((entity) => Array.isArray(entity.fields))).toBe(true);
    expect(snapshot.entities.some((entity) => entity.fields.length > 0)).toBe(true);
  });

  test('sampleValues() returns no more values than asked', async () => {
    const sample = await connection().sampleValues(
      fixture.sampleField,
      1,
      AbortSignal.timeout(10_000),
    );
    expect(sample.values.length).toBeLessThanOrEqual(1);
    expect(sample.complete).toBe(false);
  });
}

/**
 * Checks query execution: frames, row limit, abort, errors.
 *
 * @param connection - Returns the open connection.
 * @param fixture - The fixture.
 */
function testExecution(connection: () => ConnectorInstance, fixture: ConformanceFixture): void {
  test('execute() returns valid frames named after the refId', async () => {
    const frames = await connection().execute(fixture.query, contextFor(fixture, { refId: 'Q' }));
    expect(frames.length).toBeGreaterThan(0);
    frames.forEach((frame) => {
      expect(frameProblems(frame)).toEqual([]);
      expect(frame.refId).toBe('Q');
    });
    expect(frames.reduce((rows, frame) => rows + frame.meta.rowCount, 0)).toBeGreaterThanOrEqual(2);
  });

  test('execute() stops at maxRows and marks the frame truncated', async () => {
    const frames = await connection().execute(fixture.query, contextFor(fixture, { maxRows: 1 }));
    frames.forEach((frame) => {
      expect(frame.meta.rowCount).toBeLessThanOrEqual(1);
    });
    expect(frames.some((frame) => frame.meta.truncated)).toBe(true);
  });

  test('execute() rejects with a ConnectorError when the signal is already aborted', async () => {
    const signal = AbortSignal.abort();
    const failure = await connection()
      .execute(fixture.query, contextFor(fixture, { signal }))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConnectorError);
  });

  test('execute() reports a failed query as a ConnectorError with a safe message', async () => {
    const failure = await connection()
      .execute(fixture.invalidQuery, contextFor(fixture))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConnectorError);
    expect((failure as ConnectorError).safeMessage.length).toBeGreaterThan(0);
  });
}

/**
 * Registers the conformance tests of a connector kind.
 *
 * @param kind - The connector kind under test.
 * @param fixture - How to exercise it.
 */
export function testConnectorConformance(kind: ConnectorKind, fixture: ConformanceFixture): void {
  const name = fixture.label ? `${kind.kind}" on "${fixture.label}` : kind.kind;
  describe(`connector kind "${name}": declaration`, () => testDeclaration(kind, fixture));

  describe.skipIf(!fixture.live)(`connector kind "${name}": live source`, () => {
    let instance: ConnectorInstance | undefined;
    const connection = (): ConnectorInstance => {
      if (!instance) throw new Error('The connection is not open.');
      return instance;
    };
    beforeAll(() => {
      instance = kind.open({
        config: kind.configSchema.parse(fixture.config),
        secret: kind.secretSchema.parse(fixture.secret),
      });
    });
    afterAll(() => instance?.close());
    testReading(connection, fixture);
    testExecution(connection, fixture);
  });
}
