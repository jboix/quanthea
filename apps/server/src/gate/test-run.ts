/**
 * The result of a test query as the model receives it. Level 1: whether it worked. Level 2: also
 * the shape (fields, types, row counts, label names). Level 3: also per-field summaries. Level 4:
 * also the rows. Hidden fields and labels are removed at every level; below level 4 errors carry
 * only safe messages.
 */
import type { Field, Frame } from '@quanthea/shared';
import type { QueryExecutor, QueryRequest, QuerySource } from '../query/executor.ts';
import { QueryError } from '../query/query-error.ts';
import { type GateSubject, hiddenResultNames } from './subject.ts';
import { type FieldSummary, summarizeFrame } from './summaries.ts';

/** The most rows a level 4 result gives the model, whatever the connector's row limit. */
export const modelRowLimit = 500;

/** A result frame as the model sees it. */
export interface ModelFrame {
  /** The fields: names and types, with label names from level 2 and label values from level 3. */
  readonly fields: readonly {
    readonly name: string;
    readonly type: Field['type'];
    readonly labels?: unknown;
  }[];
  /** How many rows the source returned. */
  readonly rowCount: number;
  /** Whether the row limit cut the result. */
  readonly truncated: boolean;
  /** From level 3: one summary per field. */
  readonly summaries?: readonly FieldSummary[];
  /** At level 4: the rows, at most {@link modelRowLimit}. */
  readonly rows?: readonly (readonly unknown[])[];
}

/** A test query result for the model. */
export type ModelTestResult =
  | { readonly ok: true; readonly frames?: readonly ModelFrame[] }
  | { readonly ok: false; readonly error: string };

/**
 * Removes hidden fields from a frame, and hidden labels from the remaining fields.
 *
 * @param frame - The frame.
 * @param hidden - The hidden names.
 * @returns The frame without them.
 */
function withoutHidden(frame: Frame, hidden: ReadonlySet<string>): Frame {
  const kept = frame.fields.flatMap((field, index) =>
    hidden.has(field.name) ? [] : [{ field, index }],
  );
  const fields = kept.map(({ field }) => {
    if (!field.labels) return field;
    const labels = Object.fromEntries(
      Object.entries(field.labels).filter(([name]) => !hidden.has(name)),
    );
    return { ...field, labels };
  });
  return { ...frame, fields, values: kept.map(({ index }) => frame.values[index] ?? []) };
}

/**
 * The fields as the model sees them at a level.
 *
 * @param frame - The frame, without hidden fields.
 * @param level - The access level, 2 or more.
 * @returns The fields: label names at level 2, labels with values from level 3.
 */
function modelFields(frame: Frame, level: number): ModelFrame['fields'] {
  return frame.fields.map((field) => {
    if (!field.labels) return { name: field.name, type: field.type };
    const labels = level >= 3 ? field.labels : Object.keys(field.labels);
    return { name: field.name, type: field.type, labels };
  });
}

/**
 * The rows of a frame, row by row.
 *
 * @param frame - The frame.
 * @returns At most {@link modelRowLimit} rows.
 */
function rowsOf(frame: Frame): unknown[][] {
  const count = Math.min(frame.meta.rowCount, modelRowLimit);
  return Array.from({ length: count }, (_unused, row) =>
    frame.values.map((column) => column[row] ?? null),
  );
}

/**
 * One frame as the model sees it at a level.
 *
 * @param frame - The frame.
 * @param level - The access level, 2 or more.
 * @param hidden - The hidden names.
 * @returns The frame for the model.
 */
function modelFrame(frame: Frame, level: number, hidden: ReadonlySet<string>): ModelFrame {
  const visible = withoutHidden(frame, hidden);
  const truncated = frame.meta.truncated || (level >= 4 && frame.meta.rowCount > modelRowLimit);
  const shape = { fields: modelFields(visible, level), rowCount: frame.meta.rowCount, truncated };
  if (level < 3) return shape;
  const summaries = summarizeFrame(visible);
  return level < 4 ? { ...shape, summaries } : { ...shape, summaries, rows: rowsOf(visible) };
}

/**
 * A successful test query as the model receives it.
 *
 * @param subject - The connector.
 * @param frames - The frames.
 * @returns The result for the model.
 */
export function modelTestResult(subject: GateSubject, frames: readonly Frame[]): ModelTestResult {
  if (subject.accessLevel < 2) return { ok: true };
  const hidden = hiddenResultNames(subject);
  return {
    ok: true,
    frames: frames.map((frame) => modelFrame(frame, subject.accessLevel, hidden)),
  };
}

/**
 * A failed test query as the model receives it. Below level 4 only the safe message, which quotes
 * no data; at level 4 the source's own message.
 *
 * @param subject - The connector.
 * @param error - What the query threw.
 * @returns The result for the model.
 */
export function modelTestError(subject: GateSubject, error: unknown): ModelTestResult {
  if (!(error instanceof QueryError)) return { ok: false, error: 'The query failed.' };
  return { ok: false, error: subject.accessLevel >= 4 ? error.message : error.safeMessage };
}

/**
 * Runs a test query and returns what the model may see of it.
 *
 * @param subject - The connector.
 * @param executor - The query executor.
 * @param source - The resolved connector.
 * @param request - The query.
 * @returns The result for the model; it never throws.
 */
export async function testQueryForModel(
  subject: GateSubject,
  executor: QueryExecutor,
  source: QuerySource,
  request: QueryRequest,
): Promise<ModelTestResult> {
  try {
    const result = await executor.run(source, request);
    return modelTestResult(subject, result.frames);
  } catch (error) {
    return modelTestError(subject, error);
  }
}
