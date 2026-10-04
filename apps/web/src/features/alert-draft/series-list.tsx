/**
 * The series of the draft, one alert each: which would have fired at the threshold shown, and how
 * often.
 */
import type { AlertSpec } from '@quanthea/shared';
import styles from './alert-draft.module.css';
import { byWords } from './condition.ts';
import type { TrackedSeries } from './replay-model.ts';
import { seriesName } from './tunable-chart.tsx';

/** The most series the list names; the rest are counted. */
const maxListed = 8;

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
  const listed = series.slice(0, maxListed);
  const rest = series.length - listed.length;
  return (
    <section className={styles.card} aria-label="Series">
      <h3 className={styles.cardTitle}>One alert per {byWords(spec).replace(/^each /, '')}</h3>
      {series.length === 0 ? (
        <p className={styles.note}>The replay found no series.</p>
      ) : (
        <ul className={styles.series}>
          {listed.map(({ key, labels, track }) => (
            <li key={key}>
              <span className={styles.seriesName}>{seriesName(labels)}</span>
              {track.firings > 0 ? (
                <span className={styles.fired}>fired {track.firings}×</span>
              ) : (
                <span className={styles.quiet}>quiet</span>
              )}
            </li>
          ))}
          {rest > 0 && (
            <li>
              <span className={styles.quiet}>and {rest} more</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
