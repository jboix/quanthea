/**
 * The options of a query-backed variable, read from its source's frames. A source that returns a
 * `value` column and a `label` column gives each value the label a viewer reads.
 */
import type { Frame, VariableOption } from '@quanthea/shared';

/** The most options a query-backed variable lists. */
const maxOptions = 1000;

/** The longest label an option keeps, as the spec allows for a listed option. */
const maxLabelLength = 100;

/**
 * Where the values and the labels are in a frame: the `value` and `label` columns when it has
 * both, else the first text column and no labels.
 *
 * @param frame - The first frame of the source.
 * @returns The index of the values, and of the labels or -1.
 */
function columnsOf(frame: Frame | undefined): { value: number; label: number } {
  const names = frame?.fields.map((field) => field.name) ?? [];
  const value = names.indexOf('value');
  const label = names.indexOf('label');
  if (value >= 0 && label >= 0) return { value, label };
  const text = frame?.fields.findIndex((field) => field.type === 'string') ?? -1;
  return { value: text, label: -1 };
}

/**
 * One option: the value alone, or with its label when the label says something else.
 *
 * @param value - The value.
 * @param label - The label read beside it, if any.
 * @returns The option.
 */
function optionOf(value: string, label: unknown): VariableOption {
  const text = label === null || label === undefined ? '' : String(label).slice(0, maxLabelLength);
  return text === '' || text === value ? value : { value, label: text };
}

/**
 * The distinct values of a source, with their labels when it returns them.
 *
 * @param frames - The frames of the variable's source.
 * @returns At most {@link maxOptions} options, in order of appearance.
 */
export function optionsOfFrames(frames: readonly Frame[]): VariableOption[] {
  const columns = columnsOf(frames[0]);
  if (columns.value < 0) return [];
  const options = new Map<string, VariableOption>();
  for (const frame of frames) {
    const values = frame.values[columns.value] ?? [];
    values.forEach((raw, row) => {
      const value = String(raw);
      if (options.has(value)) return;
      options.set(value, optionOf(value, frame.values[columns.label]?.[row]));
    });
  }
  return [...options.values()].slice(0, maxOptions);
}
