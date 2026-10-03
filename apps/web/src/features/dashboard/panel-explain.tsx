/**
 * A panel's explanation, at the top of its info bubble on a pinned version: what the panel
 * measures, how its query computes it, and why. It is written from the query and the schema, never
 * from the data, kept per version and shown to every role. Analysts and above ask for one, or a
 * new one. Everything the model wrote is shown as plain text.
 */
import type { PanelExplanation } from '@quanthea/shared';
import { useId } from 'react';
import { Button } from '../../ui/button.tsx';
import { useCanAsk } from './ask-state.ts';
import { explainedLine, explanationParagraphs } from './explain-words.ts';
import styles from './panels.module.css';
import {
  type ExplanationTarget,
  type LiveExplanation,
  useExplain,
  useStoredExplanation,
} from './use-explain.ts';

/** Where a version's panels keep their explanations, and the time zone of their dates. */
export interface ExplainPlace {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The pinned version shown. */
  readonly version: number;
  /** The time zone of the dates. */
  readonly timeZone: string;
}

/** Props of {@link PanelExplain}. */
interface PanelExplainProps {
  /** The panel of a version. */
  readonly target: ExplanationTarget;
  /** The time zone of the date it was written. */
  readonly timeZone: string;
}

/**
 * Whether the explanation asked for here is the one to show: while it is written, and once it
 * holds until the stored one replaces it.
 *
 * @param live - The explanation asked for here.
 * @param latest - The latest stored one.
 * @returns Whether to show it.
 */
function showsLive(
  live: LiveExplanation | undefined,
  latest: PanelExplanation | null,
): live is LiveExplanation {
  if (!live) return false;
  return live.writing || (live.error === undefined && (latest?.id ?? null) === live.replaces);
}

/**
 * An explanation's text, in short paragraphs.
 *
 * @param props - The text.
 * @param props.text - The explanation.
 * @returns The paragraphs.
 */
function ExplanationText({ text }: { readonly text: string }) {
  return (
    <>
      {explanationParagraphs(text).map((paragraph) => (
        <p key={paragraph} className={styles.explainText}>
          {paragraph}
        </p>
      ))}
    </>
  );
}

/** Props of {@link ExplainBody}. */
interface ExplainBodyProps {
  /** The latest stored explanation, `undefined` while it loads. */
  readonly latest: PanelExplanation | null | undefined;
  /** Whether someone else's explanation is being written. */
  readonly generating: boolean;
  /** The explanation asked for here. */
  readonly live: LiveExplanation | undefined;
  /** Whether the person may ask for one. */
  readonly canAsk: boolean;
}

/**
 * The explanation shown: the one being written here, the latest stored, or why there is none.
 *
 * @param props - The stored and live explanations, and the right to ask.
 * @returns The body.
 */
function ExplainBody({ latest, generating, live, canAsk }: ExplainBodyProps) {
  if (latest === undefined) return <p className={styles.explainMeta}>Loading…</p>;
  if (showsLive(live, latest)) {
    if (live.text === '') return <p className={styles.explainMeta}>Reading the query…</p>;
    return <ExplanationText text={live.text} />;
  }
  if (latest) return <ExplanationText text={latest.text} />;
  if (generating)
    return <p className={styles.explainMeta}>Someone is asking for one. It shows here soon.</p>;
  if (!canAsk) return null;
  return (
    <p className={styles.explainMeta}>
      Not explained yet. An explanation reads the panel's query and the schema, never the data, and
      is kept for everyone.
    </p>
  );
}

/** Props of {@link ExplainFoot}. */
interface ExplainFootProps extends ExplainBodyProps {
  /** The time zone of the date. */
  readonly timeZone: string;
  /** Asks for an explanation in place of the one named, `null` for none. */
  readonly onExplain: (replaces: string | null) => void;
}

/**
 * When the latest explanation was written, while it is the one shown.
 *
 * @param latest - The latest stored explanation.
 * @param live - The explanation asked for here.
 * @param timeZone - The time zone of the date.
 * @returns The line, or `null`.
 */
function writtenLine(
  latest: PanelExplanation | null,
  live: LiveExplanation | undefined,
  timeZone: string,
): string | null {
  if (!latest || showsLive(live, latest)) return null;
  return explainedLine(latest, timeZone);
}

/**
 * When the explanation was written, and the button that asks for one: Explain, or Explain again.
 * Viewers see it disabled until an analyst asks.
 *
 * @param props - The explanations, the right to ask, the time zone and the callback.
 * @returns The foot.
 */
function ExplainFoot({ latest, generating, live, canAsk, timeZone, onExplain }: ExplainFootProps) {
  if (latest === undefined) return null;
  const busy = generating || live?.writing === true;
  const written = writtenLine(latest, live, timeZone);
  return (
    <div className={styles.explainFoot}>
      {live?.error && <p className={styles.explainError}>{live.error}</p>}
      {written && <span className={styles.explainMeta}>{written}</span>}
      {canAsk && <ExplainButton latest={latest} busy={busy} onExplain={onExplain} />}
      {!canAsk && !latest && <ViewerExplain />}
    </div>
  );
}

/**
 * The button that asks for an explanation: Explain, or Explain again in place of the latest.
 *
 * @param props - The latest explanation, whether one is being written, and the callback.
 * @param props.latest - The latest explanation, or `null`.
 * @param props.busy - Whether one is being written.
 * @param props.onExplain - Asks for one in place of the one named.
 * @returns The button.
 */
function ExplainButton({
  latest,
  busy,
  onExplain,
}: {
  readonly latest: PanelExplanation | null;
  readonly busy: boolean;
  readonly onExplain: (replaces: string | null) => void;
}) {
  return (
    <Button
      size="small"
      className={styles.explainAction}
      disabled={busy}
      onClick={() => onExplain(latest?.id ?? null)}
    >
      {latest ? 'Explain again' : 'Explain'}
    </Button>
  );
}

/**
 * The Explain button as a viewer sees it before anyone asked: disabled, saying who can ask.
 *
 * @returns The button and its note.
 */
function ViewerExplain() {
  const note = useId();
  return (
    <>
      <Button size="small" disabled aria-describedby={note}>
        Explain
      </Button>
      <span id={note} className={styles.explainMeta}>
        Not explained yet; an analyst can ask for it.
      </span>
    </>
  );
}

/**
 * The explanation section of a panel's info bubble.
 *
 * @param props - The panel of a version, and the time zone of the date.
 * @returns The section.
 */
export function PanelExplain({ target, timeZone }: PanelExplainProps) {
  const { stored, failed, reload } = useStoredExplanation(target);
  const { live, explain } = useExplain(target, reload);
  const canAsk = useCanAsk();
  const state = {
    latest: stored?.explanation,
    generating: stored?.generating ?? false,
    live,
    canAsk,
  };
  return (
    <section className={styles.explain} aria-label="Explanation" aria-busy={live?.writing}>
      <span className={styles.explainLabel}>Explain · from the query, not the data</span>
      {failed ? <p className={styles.explainError}>{failed}</p> : <ExplainBody {...state} />}
      <ExplainFoot {...state} timeZone={timeZone} onExplain={(id) => void explain(id)} />
    </section>
  );
}
