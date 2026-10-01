import type { ConnectorDetail, Guardrails } from '@querent/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { CheckIcon, WarningIcon } from '../../ui/icons.tsx';
import { Input } from '../../ui/input.tsx';
import styles from './connector.module.css';
import { useHealth } from './health.ts';
import { failureOf, useConnectorChange } from './use-connector-change.ts';

/** The guardrails as the form edits them: text, with the timeout in seconds. */
interface GuardrailsDraft {
  /** The query timeout, in seconds. */
  readonly timeoutSeconds: string;
  /** The row limit. */
  readonly maxRows: string;
  /** The longest time range, in days. */
  readonly maxRangeDays: string;
}

/** What each query language allows, as the screen says it. */
const allowedStatements: Readonly<Record<string, string>> = {
  sql: 'SELECT only',
  promql: 'Read endpoints only',
  search: 'Search only, no scripts',
  logql: 'Read endpoints only',
  http: 'The methods and paths it allows',
  redis: 'Read commands only',
};

/**
 * The draft of stored guardrails.
 *
 * @param guardrails - The stored guardrails.
 * @returns The draft.
 */
function draftOf(guardrails: Guardrails): GuardrailsDraft {
  return {
    timeoutSeconds: String(guardrails.timeoutMs / 1000),
    maxRows: String(guardrails.maxRows),
    maxRangeDays: String(guardrails.maxRangeDays),
  };
}

/**
 * Reads a number the user typed, allowing thousands separators.
 *
 * @param text - The text.
 * @param scale - What to multiply the number by.
 * @returns The number, or `NaN` for text that is not one. It is sent as `null`, which the server
 *   reports.
 */
function numberOf(text: string, scale = 1): number {
  const number = Number(text.trim().replaceAll(',', ''));
  return Number.isFinite(number) ? Math.round(number * scale) : Number.NaN;
}

/**
 * The guardrails a draft stands for.
 *
 * @param draft - The draft.
 * @returns The guardrails to send.
 */
function guardrailsOf(draft: GuardrailsDraft): Guardrails {
  return {
    timeoutMs: numberOf(draft.timeoutSeconds, 1000),
    maxRows: numberOf(draft.maxRows),
    maxRangeDays: numberOf(draft.maxRangeDays),
  };
}

/**
 * Whether two sets of guardrails are the same.
 *
 * @param first - One set.
 * @param second - The other.
 * @returns Whether every limit is equal.
 */
function sameGuardrails(first: Guardrails, second: Guardrails): boolean {
  const keys = ['timeoutMs', 'maxRows', 'maxRangeDays'] as const;
  return keys.every((key) => first[key] === second[key]);
}

/**
 * The line under the guardrails that says whether the connection can write, from the last test.
 *
 * @param props - The connector.
 * @param props.connector - The connector.
 * @returns The line, or nothing when the kind cannot tell.
 */
function WriteCheck({ connector }: { readonly connector: ConnectorDetail }) {
  const { report } = useHealth(connector.id, connector.updatedAt);
  if (report?.readOnly === undefined || report.readOnly === null) return null;
  return (
    <p className={report.readOnly ? styles.checkOk : styles.checkWarning}>
      {report.readOnly ? <CheckIcon /> : <WarningIcon />}
      {report.readOnly
        ? report.message
        : 'The connection can write. Queries still run read-only, but a role with SELECT grants only is safer.'}
    </p>
  );
}

/** Props of {@link GuardrailsSection}. */
interface GuardrailsSectionProps {
  /** The connector. */
  readonly connector: ConnectorDetail;
  /** The query language of its kind, such as `sql`. */
  readonly language: string | undefined;
}

/** Props of {@link GuardrailInputs}. */
interface GuardrailInputsProps {
  /** The draft. */
  readonly draft: GuardrailsDraft;
  /** Replaces the draft. */
  readonly setDraft: (draft: GuardrailsDraft) => void;
  /** The server's issue for a limit, if any. */
  readonly issue: (key: keyof Guardrails) => string | undefined;
  /** The query language of the kind, such as `sql`. */
  readonly language: string | undefined;
}

/**
 * The guardrail inputs, two by two, with what the language allows.
 *
 * @param props - The draft, its setter, the issues and the language.
 * @returns The grid.
 */
function GuardrailInputs({ draft, setDraft, issue, language }: GuardrailInputsProps) {
  const bind = (key: keyof GuardrailsDraft) => ({
    mono: true,
    inputMode: 'decimal' as const,
    value: draft[key],
    onChange: (event: { target: { value: string } }) =>
      setDraft({ ...draft, [key]: event.target.value }),
  });
  const statements = allowedStatements[language ?? ''] ?? 'Reads only';
  return (
    <div className={styles.guardrails}>
      <Input
        label="Query timeout (seconds)"
        {...bind('timeoutSeconds')}
        error={issue('timeoutMs')}
      />
      <Input label="Max rows per query" {...bind('maxRows')} error={issue('maxRows')} />
      <Input
        label="Max time range (days)"
        {...bind('maxRangeDays')}
        error={issue('maxRangeDays')}
      />
      <Input label="Statements allowed" mono readOnly value={statements} />
    </div>
  );
}

/**
 * The guardrails form: timeout, row limit and longest time range, saved with a button.
 *
 * @param props - The connector and its query language.
 * @returns The section.
 */
export function GuardrailsSection({ connector, language }: GuardrailsSectionProps) {
  const change = useConnectorChange(connector.id);
  const [draft, setDraft] = useState(() => draftOf(connector.guardrails));
  const unchanged = sameGuardrails(guardrailsOf(draft), connector.guardrails);
  const save = (event: FormEvent) => {
    event.preventDefault();
    change.submit({ intent: 'update', patch: { guardrails: guardrailsOf(draft) } });
  };
  const issue = (key: keyof Guardrails) => failureOf(change.outcome, `guardrails.${key}`);
  return (
    <form className={styles.section} aria-labelledby="guardrails-title" onSubmit={save}>
      <div className={styles.sectionHead}>
        <h3 id="guardrails-title" className={styles.sectionTitle}>
          Guardrails
        </h3>
        <p className={styles.sectionSubtitle}>
          Enforced by the server on every query, whatever the prompt says.
        </p>
      </div>
      <GuardrailInputs draft={draft} setDraft={setDraft} issue={issue} language={language} />
      <WriteCheck connector={connector} />
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" disabled={unchanged || change.pending}>
          {change.pending ? 'Saving…' : 'Save guardrails'}
        </Button>
      </div>
    </form>
  );
}
