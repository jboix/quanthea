/**
 * The table operations step of a panel run: after the queries, the panel's operations run on the
 * table of its first query, and the table they end with takes that query's frames. The server
 * runs it for every panel run, and the gate for a read the model asks for. A step that
 * cannot run fails that query's outcome with a message naming the step; the other queries keep
 * theirs.
 */
import type { Frame } from '@quanthea/plugin-kit/contract';
import type { QueryOutcome } from '../api/panels.ts';
import type { Panel } from '../spec/dashboard.ts';
import type { Operation } from '../spec/operations.ts';
import type { Dataset } from './contract.ts';
import { datasetOfFrames } from './from-frames.ts';
import { OperationError, runOperations } from './operations.ts';

/**
 * A table as one frame of a query.
 *
 * @param refId - The query's refId.
 * @param table - The table.
 * @param inputs - The frames it was made from, for what they say of themselves.
 * @returns The frame.
 */
function frameOf(refId: string, table: Dataset, inputs: readonly Frame[]): Frame {
  return {
    refId,
    fields: table.dimensions.map(({ name, type, unit }) =>
      unit === undefined ? { name, type } : { name, type, unit },
    ),
    values: table.dimensions.map((_column, index) => table.source.map((row) => row[index] ?? null)),
    meta: {
      rowCount: table.source.length,
      truncated: inputs.some((frame) => frame.meta.truncated),
      durationMs: inputs.reduce((total, frame) => total + frame.meta.durationMs, 0),
    },
  };
}

/**
 * The outcomes of a panel's queries after its operations. A panel without operations, or whose
 * first query failed, keeps its outcomes as they are. When a query a join or an append reads
 * failed, the first query fails too, saying so; the failed query keeps its own error.
 *
 * @param panel - The panel.
 * @param outcomes - The outcomes of its queries, in order.
 * @returns The outcomes, the first holding the operations' table and its columns' origins, or
 *   why a step failed.
 */
export function withOperations(
  panel: Pick<Panel, 'operations'>,
  outcomes: readonly QueryOutcome[],
): QueryOutcome[] {
  const [base, ...rest] = outcomes;
  const { operations } = panel;
  if (!operations || !base || base.error) return [...outcomes];
  const failed = rest.find((outcome) => outcome.error && readBy(operations, outcome.refId));
  if (failed)
    return [failedWith(base.refId, `the operations read ${failed.refId}, which failed`), ...rest];
  const tables = new Map(rest.map((outcome) => [outcome.refId, datasetOfFrames(outcome.frames)]));
  try {
    const { table, origins } = runOperations(
      { refId: base.refId, table: datasetOfFrames(base.frames) },
      operations,
      tables,
    );
    const frames = [frameOf(base.refId, table, base.frames)];
    const columns = origins.map((origin) => ({ ...origin, from: [...origin.from] }));
    return [{ ...base, frames, origins: columns }, ...rest];
  } catch (error) {
    if (!(error instanceof OperationError)) throw error;
    return [failedWith(base.refId, error.message), ...rest];
  }
}

/**
 * Whether a step of the operations reads a query.
 *
 * @param operations - The steps.
 * @param refId - The query.
 * @returns `true` when a join or an append reads it.
 */
function readBy(operations: readonly Operation[], refId: string): boolean {
  return operations.some((step) => 'with' in step && step.with === refId);
}

/**
 * The outcome of the first query when its operations could not run.
 *
 * @param refId - The first query.
 * @param message - Why, in words that quote no data.
 * @returns The outcome.
 */
function failedWith(refId: string, message: string): QueryOutcome {
  return { refId, frames: [], error: { code: 'invalid', message } };
}
