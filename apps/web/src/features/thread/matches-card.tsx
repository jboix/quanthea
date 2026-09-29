import type { ThreadData } from '@querent/shared';
import { Link } from 'react-router';
import { Button } from '../../ui/button.tsx';
import styles from './cards.module.css';

/** Props of {@link MatchesCard}. */
interface MatchesCardProps {
  /** The matching pinned dashboards. */
  readonly data: ThreadData['matches'];
  /** Whether the person can still choose: the latest answer, with nothing running. */
  readonly answerable: boolean;
  /** Starts the thread's draft from a copy of a pinned dashboard. */
  readonly onStartFrom: (dashboardId: string) => void;
  /** Asks the agent for a new dashboard instead. */
  readonly onBuildNew: () => void;
}

/**
 * Pinned dashboards that may already answer the question, found with no model: open one, start
 * from a copy of one, or build a new one.
 *
 * @param props - The matches, whether they can be chosen, and the callbacks.
 * @returns The card.
 */
export function MatchesCard({ data, answerable, onStartFrom, onBuildNew }: MatchesCardProps) {
  return (
    <section className={styles.matches} aria-label="Pinned dashboards that may answer this">
      <ul className={styles.matchList}>
        {data.dashboards.map((match) => (
          <li key={match.dashboardId} className={styles.match}>
            <div className={styles.matchText}>
              <span className={styles.matchTitle}>{match.title}</span>
              <span className={styles.matchPanels}>{match.panels.join(' · ')}</span>
            </div>
            <Link to={`/d/${match.dashboardId}`} className={styles.link}>
              Open
            </Link>
            <Button
              size="small"
              disabled={!answerable}
              onClick={() => onStartFrom(match.dashboardId)}
            >
              Start from this
            </Button>
          </li>
        ))}
      </ul>
      {answerable && (
        <footer className={styles.matchActions}>
          <Button size="small" variant="primary" onClick={onBuildNew}>
            Build a new one
          </Button>
          <span className={styles.hint}>Starting from one uses no model.</span>
        </footer>
      )}
    </section>
  );
}
