/**
 * The value of a computed variable, read from its source's frames: the column it names, or the
 * first, of the first row, or of every row when it holds several values.
 */
import {
  type Frame,
  maxComputedValueLength,
  maxComputedValues,
  type Variable,
} from '@quanthea/shared';
import { AppError } from '../lib/errors.ts';

/** A computed variable. */
export type ComputedVariable = Extract<Variable, { kind: 'computed' }>;

/**
 * Fails the variable.
 *
 * @param variable - The variable.
 * @param message - What is wrong.
 * @returns Never.
 * @throws {AppError} `source_failed`.
 */
function fail(variable: ComputedVariable, message: string): never {
  throw new AppError('source_failed', `$${variable.name} ${message}`);
}

/**
 * The column a computed variable reads in a frame.
 *
 * @param variable - The variable.
 * @param frame - The frame.
 * @returns Its index.
 * @throws {AppError} `source_failed` when the frame has no such column.
 */
function columnOf(variable: ComputedVariable, frame: Frame): number {
  if (variable.field === undefined) return frame.fields.length > 0 ? 0 : -1;
  const index = frame.fields.findIndex((field) => field.name === variable.field);
  if (index < 0) fail(variable, `reads "${variable.field}", which its query does not return.`);
  return index;
}

/**
 * Every value of the variable's column, in order, without missing values.
 *
 * @param variable - The variable.
 * @param frames - The frames of its source.
 * @returns The values as text.
 */
function valuesOf(variable: ComputedVariable, frames: readonly Frame[]): string[] {
  return frames.flatMap((frame) => {
    const column = frame.values[columnOf(variable, frame)] ?? [];
    return column.filter((value) => value !== null && value !== undefined).map(String);
  });
}

/**
 * The values of a computed variable: the first one, or every distinct one when it holds several,
 * cut at {@link maxComputedValues}.
 *
 * @param variable - The variable.
 * @param frames - The frames of its source.
 * @returns The values; an empty list for a variable of several values whose query found none.
 * @throws {AppError} `source_failed` for a single value with no row, or a value too long.
 */
export function computedValues(variable: ComputedVariable, frames: readonly Frame[]): string[] {
  const all = valuesOf(variable, frames);
  const values = variable.multi ? [...new Set(all)].slice(0, maxComputedValues) : all.slice(0, 1);
  if (!variable.multi && values.length === 0)
    fail(variable, 'has no value: its query found no row.');
  if (values.some((value) => value.length > maxComputedValueLength))
    fail(variable, `has a value over ${maxComputedValueLength} characters.`);
  return values;
}
