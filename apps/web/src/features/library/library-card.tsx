import type { LibraryEntry } from '@querent/shared';
import { Link } from 'react-router';
import { buttonClassName } from '../../ui/button.tsx';
import { VariantIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { PanelPreview } from '../dashboard/index.ts';
import styles from './library.module.css';

/**
 * The panels of a dashboard that match the search, each a link to it on the dashboard.
 *
 * @param props - The entry.
 * @param props.entry - The dashboard.
 * @returns The list, or nothing when no panel matches on its own.
 */
function MatchingPanels({ entry }: { readonly entry: LibraryEntry }) {
  if (entry.panels.length === 0) return null;
  return (
    <div className={styles.matches}>
      <p className={styles.matchesLabel}>Matching panels</p>
      <ul className={styles.matchList}>
        {entry.panels.map((panel) => (
          <li key={panel.id}>
            <Link
              to={`/d/${entry.dashboardId}#panel-${panel.id}`}
              title={panel.description ?? undefined}
            >
              {panel.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A card's facts: how many panels and which connectors, the dashboard it was copied from, and its
 * tags.
 *
 * @param props - The entry.
 * @param props.entry - The dashboard.
 * @returns The facts.
 */
function CardFacts({ entry }: { readonly entry: LibraryEntry }) {
  const panels = entry.panelCount === 1 ? '1 panel' : `${entry.panelCount} panels`;
  return (
    <>
      <p className={styles.meta}>
        {panels} · <span className={styles.mono}>{entry.connectors.join(', ')}</span>
      </p>
      {entry.parent && (
        <p className={styles.meta}>
          <VariantIcon /> Variant of{' '}
          <Link to={`/d/${entry.parent.dashboardId}`}>{entry.parent.title}</Link>
        </p>
      )}
      {entry.tags.length > 0 && (
        <p className={styles.tags}>{entry.tags.map((tag) => `#${tag}`).join(' ')}</p>
      )}
    </>
  );
}

/**
 * One pinned dashboard in the library: its title and version, one panel drawn live, its facts,
 * the panels that match the search, and a link to open it.
 *
 * @param props - The entry.
 * @param props.entry - The dashboard.
 * @returns The card.
 */
export function LibraryCard({ entry }: { readonly entry: LibraryEntry }) {
  const titleId = `library-${entry.dashboardId}`;
  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <header className={styles.cardHead}>
        <h2 id={titleId} className={styles.cardTitle}>
          <Link to={`/d/${entry.dashboardId}`}>{entry.title}</Link>
        </h2>
        <Pill shape="tag" mono>
          Pinned · v{entry.version}
        </Pill>
      </header>
      {entry.preview && (
        <figure className={styles.figure}>
          <PanelPreview
            dashboardId={entry.dashboardId}
            version={entry.version}
            panel={entry.preview}
            timeZone={entry.timeZone ?? undefined}
          />
          <figcaption className={styles.caption}>{entry.preview.title}</figcaption>
        </figure>
      )}
      <CardFacts entry={entry} />
      <MatchingPanels entry={entry} />
      <footer className={styles.cardFoot}>
        <Link to={`/d/${entry.dashboardId}`} className={buttonClassName('secondary')}>
          Open
        </Link>
      </footer>
    </article>
  );
}
