import { diffLines, type ThreadData } from '@querent/shared';
import { Button } from '../../ui/button.tsx';
import styles from './cards.module.css';

/** The diff card's data. */
type DiffData = ThreadData['diff'];

/** One changed panel of a diff. */
type ChangedPanel = DiffData['panels'][number];

/** One line of the card. */
interface Line {
  /** `-` removed, `+` added. */
  readonly kind: '-' | '+';
  /** The text. */
  readonly text: string;
}

/** The most lines a panel shows. */
const maxLines = 12;

/**
 * The lines of one field change. Queries diff line by line; other fields show before and after.
 *
 * @param change - The change.
 * @returns The lines.
 */
function changeLines(change: ChangedPanel['changes'][number]): Line[] {
  const { path, before, after } = change;
  if (/^queries\[\d+\]\.(expr|sql)$/.test(path) && before !== undefined && after !== undefined) {
    return diffLines(before, after).flatMap((line) =>
      line.kind === ' ' ? [] : [{ kind: line.kind, text: line.text }],
    );
  }
  const lines: Line[] = [];
  if (before !== undefined) lines.push({ kind: '-', text: `${path}: ${before}` });
  if (after !== undefined) lines.push({ kind: '+', text: `${path}: ${after}` });
  return lines;
}

/**
 * The lines of one panel.
 *
 * @param panel - The changed panel.
 * @returns The lines.
 */
function panelLines(panel: ChangedPanel): Line[] {
  if (panel.status === 'added') return [{ kind: '+', text: 'panel added' }];
  if (panel.status === 'removed') return [{ kind: '-', text: 'panel removed' }];
  return panel.changes.flatMap(changeLines);
}

/** Props of {@link DiffCard}. */
export interface DiffCardProps {
  /** The diff. */
  readonly diff: DiffData;
  /** The latest version of the dashboard, so only the latest change offers Undo. */
  readonly latestVersion: number;
  /** Whether a change is on its way. */
  readonly busy: boolean;
  /** Restores a version as a new one. */
  readonly onUndo: (version: number) => void;
  /** Shows a version in the right pane. */
  readonly onCompare: (version: number) => void;
}

/**
 * What changed from one version to the next, with Undo and Compare.
 *
 * @param props - The diff, the latest version and the callbacks.
 * @returns The card.
 */
export function DiffCard({ diff, latestVersion, busy, onUndo, onCompare }: DiffCardProps) {
  return (
    <section className={styles.diff} aria-label={`Changes from v${diff.from} to v${diff.to}`}>
      {diff.panels.map((panel) => {
        const lines = panelLines(panel).map((line, position) => ({
          ...line,
          key: String(position),
        }));
        return (
          <div key={panel.id} className={styles.diffPanel}>
            <header className={styles.diffHead}>
              <span>{panel.title}</span>
              <span className={styles.mono}>
                v{diff.from} → v{diff.to}
              </span>
            </header>
            <ul className={styles.diffLines}>
              {lines.slice(0, maxLines).map((line) => (
                <li key={line.key} data-kind={line.kind}>
                  {line.kind} {line.text}
                </li>
              ))}
              {lines.length > maxLines && <li>… {lines.length - maxLines} more lines</li>}
            </ul>
          </div>
        );
      })}
      <footer className={styles.diffActions}>
        <Button
          size="small"
          disabled={busy || diff.to !== latestVersion}
          onClick={() => onUndo(diff.from)}
        >
          Undo
        </Button>
        <Button size="small" onClick={() => onCompare(diff.from)}>
          Compare v{diff.from}
        </Button>
      </footer>
    </section>
  );
}
