import type { DefinitionShape } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Segmented } from '../../ui/segmented.tsx';
import { Select } from '../../ui/select.tsx';
import {
  type BodyDraft,
  bodyOfDraft,
  type FilterDraft,
  type FilterOp,
  type FormLanguageId,
  filterOps,
  formLanguages,
} from './body-form-model.ts';
import { bodyWords } from './body-words.ts';
import editor from './editor.module.css';

/** What each shape means, under the choice. */
const shapeHints: Readonly<Record<DefinitionShape, string>> = {
  ratio:
    'A share: the rows that match the part, out of the whole. Such as failed orders out of all orders.',
  measure: 'A number: a count, a sum or an average over some rows. Such as revenue.',
  segment: 'A set of rows, added to any panel’s filters. Such as production traffic.',
};

/** The words of each measure, in the measure's menu. */
const fnWords: Readonly<Record<string, string>> = {
  count: 'Count the rows',
  sum: 'Sum of',
  avg: 'Average of',
  min: 'Lowest',
  max: 'Highest',
  count_distinct: 'Distinct values of',
  cardinality: 'Distinct values of',
};

/** Props of {@link FilterRows}. */
interface FilterRowsProps {
  /** What the rows filter, such as `Rows where`. */
  readonly label: string;
  readonly rows: readonly FilterDraft[];
  readonly onChange: (rows: readonly FilterDraft[]) => void;
}

/**
 * One filter: the field, how it compares, and the value.
 *
 * @param props - The filter, and the change and remove callbacks.
 * @param props.row - The filter.
 * @param props.onChange - Changes it.
 * @param props.onRemove - Removes it.
 * @returns The row.
 */
function FilterRow({
  row,
  onChange,
  onRemove,
}: {
  readonly row: FilterDraft;
  readonly onChange: (row: FilterDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <div className={editor.filter}>
      <Input
        label="Field"
        hideLabel
        mono
        placeholder="field"
        value={row.field}
        onChange={(event) => onChange({ ...row, field: event.target.value })}
      />
      <Select
        label="Compares"
        hideLabel
        compact
        options={filterOps.map(({ op, words }) => ({ value: op, label: words }))}
        value={row.op}
        onChange={(event) => onChange({ ...row, op: event.target.value as FilterOp })}
      />
      <Input
        label="Value"
        hideLabel
        mono
        placeholder="value"
        value={row.value}
        onChange={(event) => onChange({ ...row, value: event.target.value })}
      />
      <button type="button" className={editor.remove} aria-label="Remove" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

/**
 * Filter rows, with a button that adds one.
 *
 * @param props - The label, the rows and the change callback.
 * @returns The rows.
 */
function FilterRows({ label, rows, onChange }: FilterRowsProps) {
  const set = (index: number, row: FilterDraft) =>
    onChange(rows.map((each, at) => (at === index ? row : each)));
  return (
    <fieldset className={editor.filters}>
      <legend>{label}</legend>
      {rows.map((row, index) => (
        <FilterRow
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id, and keep their place.
          key={index}
          row={row}
          onChange={(changed) => set(index, changed)}
          onRemove={() => onChange(rows.filter((_, at) => at !== index))}
        />
      ))}
      <Button size="small" onClick={() => onChange([...rows, { field: '', op: '=', value: '' }])}>
        Add a filter
      </Button>
    </fieldset>
  );
}

/**
 * What a measure measures: its function and, past a count, the column.
 *
 * @param props - The form and its change callback.
 * @param props.draft - The form.
 * @param props.onChange - Changes it.
 * @returns The fields, or nothing for a language that measures no column.
 */
function MeasureFields({
  draft,
  onChange,
}: {
  readonly draft: BodyDraft;
  readonly onChange: (draft: BodyDraft) => void;
}) {
  const language = formLanguages[draft.language];
  if (draft.shape !== 'measure' || language.fns.length === 0) return null;
  return (
    <div className={editor.measure}>
      <Select
        label="Measure"
        options={language.fns.map((fn) => ({ value: fn, label: fnWords[fn] ?? fn }))}
        value={draft.fn}
        onChange={(event) => onChange({ ...draft, fn: event.target.value })}
      />
      {draft.fn !== 'count' && (
        <Input
          label="Column"
          mono
          value={draft.column}
          onChange={(event) => onChange({ ...draft, column: event.target.value })}
        />
      )}
    </div>
  );
}

/**
 * Where the rows come from, and what a measure measures.
 *
 * @param props - The form and its change callback.
 * @param props.draft - The form.
 * @param props.onChange - Changes it.
 * @returns The fields.
 */
function SourceFields({
  draft,
  onChange,
}: {
  readonly draft: BodyDraft;
  readonly onChange: (draft: BodyDraft) => void;
}) {
  const language = formLanguages[draft.language];
  return (
    <div className={editor.sourceRow}>
      <Select
        label="Data"
        options={Object.entries(formLanguages).map(([id, each]) => ({
          value: id,
          label: each.label,
        }))}
        value={draft.language}
        onChange={(event) => onChange({ ...draft, language: event.target.value as FormLanguageId })}
      />
      <Input
        label={language.sourceLabel}
        mono
        value={draft.source}
        onChange={(event) => onChange({ ...draft, source: event.target.value })}
      />
    </div>
  );
}

/** Props of {@link BodyForm}. */
interface BodyFormProps {
  readonly draft: BodyDraft;
  readonly onChange: (draft: BodyDraft) => void;
  readonly onRemove: () => void;
}

/**
 * One body as a form: its data, its shape, the filters, and what it says in words as it is
 * written.
 *
 * @param props - The form, and the change and remove callbacks.
 * @returns The form.
 */
export function BodyForm({ draft, onChange, onRemove }: BodyFormProps) {
  const ratio = draft.shape === 'ratio';
  return (
    <div className={editor.bodyForm}>
      <Segmented
        label="What it is"
        options={[
          { value: 'ratio', label: 'A share' },
          { value: 'measure', label: 'A number' },
          { value: 'segment', label: 'A set of rows' },
        ]}
        value={draft.shape}
        onChange={(shape) => onChange({ ...draft, shape })}
      />
      <p className={editor.hint}>{shapeHints[draft.shape]}</p>
      <SourceFields draft={draft} onChange={onChange} />
      <MeasureFields draft={draft} onChange={onChange} />
      <FilterRows
        label={ratio ? 'The whole: rows where (leave empty for every row)' : 'Rows where'}
        rows={draft.filters}
        onChange={(filters) => onChange({ ...draft, filters })}
      />
      {ratio && (
        <FilterRows
          label="The part: of those, the rows where"
          rows={draft.part}
          onChange={(part) => onChange({ ...draft, part })}
        />
      )}
      <p className={editor.inWords}>
        <strong>In words</strong> {bodyWords(bodyOfDraft(draft))}
      </p>
      <Button size="small" variant="danger" onClick={onRemove}>
        Remove these filters
      </Button>
    </div>
  );
}
