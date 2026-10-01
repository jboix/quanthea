/** Builds a frame row by row, stopping at the row limit. */
import type { Field, Frame } from '@querent/shared';

/** Collects rows into a frame. */
export interface FrameBuilder {
  /**
   * Adds a row. Past the row limit the row is dropped and the frame is marked truncated.
   *
   * @param row - One value per field, in field order.
   * @returns `false` when the row was dropped because the frame is full: stop reading.
   */
  add(row: readonly unknown[]): boolean;
  /**
   * Finishes the frame.
   *
   * @param durationMs - How long the query took.
   * @returns The frame.
   */
  build(durationMs: number): Frame;
}

/** What a frame builder needs to know. */
export interface FrameBuilderOptions {
  /** The frame name the query was given (`ExecutionContext.refId`). */
  readonly refId: string;
  /** The fields, in column order. */
  readonly fields: readonly Field[];
  /** The row limit (`ExecutionContext.maxRows`). */
  readonly maxRows: number;
  /** A name for the frame, such as a series name. */
  readonly name?: string;
}

/**
 * Creates a frame builder. Read one row more than the limit so the builder can tell the frame was
 * truncated.
 *
 * @param options - The frame name, fields and row limit.
 * @returns The builder.
 */
export function createFrameBuilder(options: FrameBuilderOptions): FrameBuilder {
  const columns: unknown[][] = options.fields.map(() => []);
  let rowCount = 0;
  let truncated = false;
  return {
    add(row) {
      if (rowCount >= options.maxRows) {
        truncated = true;
        return false;
      }
      columns.forEach((column, index) => {
        column.push(row[index] ?? null);
      });
      rowCount += 1;
      return true;
    },
    build(durationMs) {
      const frame: Frame = {
        refId: options.refId,
        fields: [...options.fields],
        values: columns,
        meta: { rowCount, truncated, durationMs: Math.round(durationMs) },
      };
      return options.name === undefined ? frame : { ...frame, name: options.name };
    },
  };
}
