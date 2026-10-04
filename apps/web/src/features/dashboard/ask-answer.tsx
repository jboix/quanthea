/**
 * An answer about the dashboard: its text with the citation markers as numbered badges, and what
 * it looked at. Everything the model wrote is shown as plain text.
 */
import type { Answer, AnswerEvidence, DashboardSpec } from '@quanthea/shared';
import styles from './ask.module.css';
import { evidenceLines } from './ask-evidence.ts';
import { answerSegments } from './ask-words.ts';

/**
 * A citation's number, as a small badge.
 *
 * @param props - The number.
 * @param props.n - The citation's number.
 * @returns The badge.
 */
export function CitationBadge({ n }: { readonly n: number }) {
  return (
    <span className={styles.badge} role="note" aria-label={`citation ${n}`}>
      {n}
    </span>
  );
}

/**
 * The pieces of an answer's text: words, and its markers as badges.
 *
 * @param props - The text.
 * @param props.text - The answer's text, with markers such as `[1]`.
 * @returns The pieces.
 */
function AnswerPieces({ text }: { readonly text: string }) {
  return answerSegments(text).map((segment) =>
    segment.kind === 'text' ? (
      <span key={segment.at}>{segment.text}</span>
    ) : (
      <CitationBadge key={segment.at} n={segment.n} />
    ),
  );
}

/**
 * An answer's text, its markers drawn as badges. With `onPick`, it is a toggle button that makes
 * it the answer the charts show, pressed while they do.
 *
 * @param props - The text, and the pick callback with whether the charts show it.
 * @param props.text - The answer's text, with markers such as `[1]`.
 * @param props.onPick - Makes it the answer the charts show; left out when it can't be.
 * @param props.shown - Whether the charts show it.
 * @returns The paragraph or the button.
 */
export function AnswerText({
  text,
  onPick,
  shown = false,
}: {
  readonly text: string;
  readonly onPick?: (() => void) | undefined;
  readonly shown?: boolean;
}) {
  if (!onPick)
    return (
      <p className={styles.answerText}>
        <AnswerPieces text={text} />
      </p>
    );
  return (
    <button type="button" className={styles.answerPick} aria-pressed={shown} onClick={onPick}>
      <AnswerPieces text={text} />
    </button>
  );
}

/** Props of {@link EvidenceList}. */
interface EvidenceListProps {
  /** Every read the answer made. */
  readonly evidence: readonly AnswerEvidence[];
  /** The citations, to number each read. */
  readonly citations: Answer['citations'];
  /** The spec, for the panels' titles. */
  readonly spec: DashboardSpec;
  /** The time zone of the times. */
  readonly timeZone: string;
}

/**
 * "What I looked at": each read with its connector, its panel and a summary of what the gate let
 * out, behind a disclosure.
 *
 * @param props - The reads, the citations, the spec and the time zone.
 * @returns The disclosure, or nothing without reads.
 */
export function EvidenceList({ evidence, citations, spec, timeZone }: EvidenceListProps) {
  if (evidence.length === 0) return null;
  const titleOf = (panelId: string | undefined) =>
    spec.panels.find((panel) => panel.id === panelId)?.title;
  const count = `${evidence.length} ${evidence.length === 1 ? 'read' : 'reads'}`;
  return (
    <details className={styles.evidence}>
      <summary>What I looked at · {count}</summary>
      <ol className={styles.evidenceList}>
        {evidence.map((read) => (
          <li key={read.id}>
            <span className={styles.evidenceBadges}>
              {citations
                .filter((citation) => citation.evidenceId === read.id)
                .map((citation) => (
                  <CitationBadge key={citation.n} n={citation.n} />
                ))}
            </span>
            <span className={styles.evidenceBody}>
              <span>
                <strong>{titleOf(read.panelId) ?? 'A query of its own'}</strong>
                <span className={styles.mono}> · {read.connector}</span>
              </span>
              {evidenceLines(read.result, timeZone).map((line) => (
                <span key={line} className={styles.evidenceLine}>
                  {line}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * The honest note of an answer given with no source that shows numbers.
 *
 * @returns The note.
 */
export function ExplainOnlyNote() {
  return (
    <p className={styles.explainNote}>
      Explain only: no source of this dashboard shows numbers, so this answer could explain the
      panels and their queries but could not read what happened.
    </p>
  );
}
