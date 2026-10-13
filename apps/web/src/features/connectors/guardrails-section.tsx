import type { ConnectorDetail, Guardrails } from '@quanthea/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { CheckIcon, LockIcon } from '../../ui/icons.tsx';
import { Input } from '../../ui/input.tsx';
import { offersBucketScripts } from './bucket-scripts.ts';
import { BucketScriptsCard } from './bucket-scripts-card.tsx';
import styles from './connector.module.css';
import { enforcedRules } from './enforced-rules.ts';
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
 * The line under the guardrails that says the connection only reads, from the last test. The
 * warning for one that can write is at the top of the page.
 *
 * @param props - The connector.
 * @param props.connector - The connector.
 * @returns The line, or nothing when the credentials can write or the kind cannot tell.
 */
function WriteCheck({ connector }: { readonly connector: ConnectorDetail }) {
  const { report } = useHealth(connector.id, connector.updatedAt);
  if (report?.readOnly !== true) return null;
  return (
    <p className={styles.checkOk}>
      <CheckIcon />
      {report.message}
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
}

/**
 * The inputs of the limits an admin sets.
 *
 * @param props - The draft, its setter and the issues.
 * @returns The grid.
 */
function GuardrailInputs({ draft, setDraft, issue }: GuardrailInputsProps) {
  const bind = (key: keyof GuardrailsDraft) => ({
    mono: true,
    inputMode: 'decimal' as const,
    value: draft[key],
    onChange: (event: { target: { value: string } }) =>
      setDraft({ ...draft, [key]: event.target.value }),
  });
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
    </div>
  );
}

/**
 * The limits an admin sets: timeout, row limit and longest time range, saved with a button.
 *
 * @param props - The connector.
 * @param props.connector - The connector.
 * @returns The form.
 */
function LimitsForm({ connector }: { readonly connector: ConnectorDetail }) {
  const change = useConnectorChange(connector.id);
  const [draft, setDraft] = useState(() => draftOf(connector.guardrails));
  const unchanged = sameGuardrails(guardrailsOf(draft), connector.guardrails);
  const save = (event: FormEvent) => {
    event.preventDefault();
    change.submit({ intent: 'update', patch: { guardrails: guardrailsOf(draft) } });
  };
  const issue = (key: keyof Guardrails) => failureOf(change.outcome, `guardrails.${key}`);
  return (
    <form className={styles.card} aria-labelledby="limits-title" onSubmit={save}>
      <h4 id="limits-title" className={styles.cardTitle}>
        Limits you set
      </h4>
      <GuardrailInputs draft={draft} setDraft={setDraft} issue={issue} />
      <p className={styles.cardNote}>
        The access level above is the other setting that bounds a query's result.
      </p>
      <div className={styles.formActions}>
        <Button type="submit" variant="primary" disabled={unchanged || change.pending}>
          {change.pending ? 'Saving…' : 'Save limits'}
        </Button>
      </div>
    </form>
  );
}

/** Props of {@link AlwaysEnforced}. */
interface AlwaysEnforcedProps {
  /** The query language of the connector's kind, such as `sql`. */
  readonly language: string | undefined;
  /** Whether the connector allows bucket scripts, which one rule of a search follows. */
  readonly bucketScripts: boolean;
}

/**
 * The fixed rules of the connector's query language, as a list: nothing here is an input, since
 * nothing here can be changed.
 *
 * @param props - The query language and the setting a rule follows.
 * @returns The card, or nothing for a language without listed rules.
 */
function AlwaysEnforced({ language, bucketScripts }: AlwaysEnforcedProps) {
  const rules = enforcedRules(language, { bucketScripts });
  if (rules.length === 0) return null;
  return (
    <div className={styles.card}>
      <h4 id="enforced-title" className={styles.cardTitle}>
        <LockIcon />
        Always enforced
      </h4>
      <p className={styles.cardNote}>
        Rules, not settings. Turning one off would run text a model wrote on the documents of the
        data source.
      </p>
      <ul className={styles.rules} aria-labelledby="enforced-title">
        {rules.map(({ rule, stops }) => (
          <li key={rule} className={styles.rule}>
            <span className={styles.ruleName}>{rule}</span>
            <span className={styles.ruleStops}>{stops}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The guardrails: the limits an admin sets, for a search whether a bucket aggregation may hold a
 * script, and apart from them the rules nobody can change.
 *
 * @param props - The connector and its query language.
 * @returns The section.
 */
export function GuardrailsSection({ connector, language }: GuardrailsSectionProps) {
  return (
    <section className={styles.section} aria-labelledby="guardrails-title">
      <div className={styles.sectionHead}>
        <h3 id="guardrails-title" className={styles.sectionTitle}>
          Guardrails
        </h3>
        <p className={styles.sectionSubtitle}>
          Enforced by the server on every query, whatever the prompt says.
        </p>
      </div>
      <LimitsForm connector={connector} />
      <WriteCheck connector={connector} />
      {offersBucketScripts(language) && <BucketScriptsCard connector={connector} />}
      <AlwaysEnforced language={language} bucketScripts={connector.bucketScripts} />
    </section>
  );
}
