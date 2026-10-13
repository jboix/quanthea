/**
 * The series of the draft, one alert each: which would have fired at the threshold shown, and how
 * often, ten at a time.
 */
import type { AlertSpec } from '@quanthea/shared';
import { Pager } from '../../ui/pager.tsx';
import { useLocalPages } from '../../ui/use-local-pages.ts';
import styles from './alert-draft.module.css';
import { byWords } from './condition.ts';
import type { TrackedSeries } from './replay-model.ts';
import { seriesName } from './tunable-chart.tsx';

/** How many series a page of the list shows. */
const seriesPerPage = 10;

/** What the controls of the pager say: the list is by how long each fired, not by time. */
const pagerWords = { newer: 'Previous', older: 'Next' } as const;

/**
 * The series card.
 *
 * @param props - The spec and the series.
 * @param props.spec - The draft's spec.
 * @param props.series - The series, those that fired longest first.
 * @returns The card.
 */
export function SeriesList({
  spec,
  series,
}: {
  readonly spec: AlertSpec;
  readonly series: readonly TrackedSeries[];
}) {
  const pages = useLocalPages(series, seriesPerPage);
  return (
    <section className={styles.card} aria-label="Series">
      <h3 className={styles.cardTitle}>One alert per {byWords(spec).replace(/^each /, '')}</h3>
      {series.length === 0 ? (
        <p className={styles.note}>The replay found no series.</p>
      ) : (
        <ul className={styles.series}>
          {pages.shown.map(({ key, labels, track }) => (
            <li key={key}>
              <span className={styles.seriesName}>{seriesName(labels)}</span>
              {track.firings > 0 ? (
                <span className={styles.fired}>fired {track.firings}×</span>
              ) : (
                <span className={styles.quiet}>quiet</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager
        label="Series, pages"
        words={pagerWords}
        {...{ offset: pages.offset, shown: pages.shown.length, total: series.length }}
        onNewer={pages.onBefore}
        onOlder={pages.onAfter}
      />
    </section>
  );
}
