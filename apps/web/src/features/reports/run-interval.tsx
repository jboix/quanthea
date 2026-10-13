/**
 * The interval of a run's charts: a chip to choose it, and a line saying what the charts show
 * once another one is chosen. The stored run never changes.
 */
import type { ReportRunDetail } from '@quanthea/shared';
import { IntervalChip } from '../dashboard/index.ts';
import { redrawChoices } from './redraw-data.ts';
import styles from './run.module.css';
import type { useRedraw } from './use-redraw.ts';

/**
 * What the line beside the chip says.
 *
 * @param drawn - The interval chosen and what came back for it.
 * @returns Why the charts could not be drawn again, that they load, or what they show.
 */
export function intervalNote(drawn: Omit<ReturnType<typeof useRedraw>, 'choose'>): string {
  if (drawn.failure !== undefined) return `${drawn.failure} The charts show the run as stored.`;
  if (drawn.loading) return `Running the charts again by ${drawn.interval}…`;
  if (!drawn.redraw) return 'The charts show the run as it was stored.';
  return `The charts are drawn again by ${drawn.redraw.interval}, from the data as it is now. The numbers and the stored run are unchanged.`;
}

/**
 * The chip and its line, for a run with a chart that follows the interval; nothing otherwise.
 *
 * @param props - The run, and the interval chosen with what came back for it.
 * @param props.run - The run.
 * @param props.drawn - The interval chosen, the charts drawn again and the chip's callback.
 * @returns The row, or nothing when no chart would change.
 */
export function RunInterval({
  run,
  drawn,
}: {
  readonly run: ReportRunDetail;
  readonly drawn: ReturnType<typeof useRedraw>;
}) {
  const choices = redrawChoices(run);
  if (choices.length === 0) return null;
  return (
    <div className={styles.interval}>
      <IntervalChip
        choices={choices}
        value={drawn.interval}
        automatic="as stored"
        onChange={drawn.choose}
      />
      <p className={styles.intervalNote} aria-live="polite">
        {intervalNote(drawn)}
      </p>
    </div>
  );
}
