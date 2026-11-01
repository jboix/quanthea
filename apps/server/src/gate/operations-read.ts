/**
 * A read of a panel whose operations make its table: every query runs, the operations run on
 * their results, and the model receives the table they end with, each connector's part at its own
 * access level (`derived.ts`). A query that fails gives that connector's failure as a test query
 * does.
 */
import { type Operation, type QueryOutcome, withOperations } from '@quanthea/shared';
import type { QueryExecutor, QueryRequest, QuerySource } from '../query/executor.ts';
import { modelDerivedResult } from './derived.ts';
import { unreachable } from './panel-results.ts';
import type { GateSubject } from './subject.ts';
import { type ModelTestResult, modelTestError } from './test-run.ts';

/** One query of the panel to read: its connector and the request. */
export interface PanelRead {
  /** The connector. */
  readonly connector: string;
  /** The request, with the query's refId. */
  readonly request: QueryRequest;
}

/** An opened connector. */
interface Opened {
  /** The query engine's view of it. */
  readonly source: QuerySource;
  /** The gate's view of it. */
  readonly subject: GateSubject;
}

/**
 * Runs one query of the read.
 *
 * @param executor - The query executor.
 * @param opened - Its connector.
 * @param request - The request.
 * @returns Its outcome, or what the model receives of its failure.
 */
async function runOne(
  executor: QueryExecutor,
  opened: Opened,
  request: QueryRequest,
): Promise<QueryOutcome | { failure: ModelTestResult }> {
  try {
    const result = await executor.run(opened.source, request);
    return { refId: request.refId, frames: [...result.frames], error: null };
  } catch (error) {
    return { failure: modelTestError(opened.subject, error) };
  }
}

/**
 * Reads a panel's table as its operations make it.
 *
 * @param open - Opens a connector by name.
 * @param executor - The query executor.
 * @param reads - The panel's queries, the first one first.
 * @param operations - The panel's operations.
 * @param timeZone - The reader's time zone, as a test query takes it.
 * @returns What the model receives; it never throws.
 */
export async function readOperationsForModel(
  open: (name: string) => Promise<Opened>,
  executor: QueryExecutor,
  reads: readonly PanelRead[],
  operations: readonly Operation[],
  timeZone?: string,
): Promise<ModelTestResult> {
  const opened = await Promise.all(
    reads.map((read) => open(read.connector).catch(() => undefined)),
  );
  const missing = reads.find((_read, index) => opened[index] === undefined);
  if (missing) return { ok: false, error: unreachable(missing.connector) };
  const ready = opened as Opened[];
  const outcomes = await Promise.all(
    reads.map((read, index) => runOne(executor, ready[index] as Opened, read.request)),
  );
  const failed = outcomes.find((outcome) => 'failure' in outcome);
  if (failed && 'failure' in failed) return failed.failure;
  const [base] = withOperations({ operations: [...operations] }, outcomes as QueryOutcome[]);
  if (!base || base.error) return { ok: false, error: base?.error?.message ?? 'Nothing ran.' };
  const subjects = new Map(
    reads.map((read, index) => [read.request.refId, ready[index]?.subject as GateSubject]),
  );
  return modelDerivedResult(base.frames, base.origins ?? [], subjects, timeZone);
}
