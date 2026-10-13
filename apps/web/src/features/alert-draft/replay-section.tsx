/**
 * The replay of the draft: the last 24 hours or 7 days as it would have fired, with the threshold
 * as a dashed line a person drags. While it moves, the browser replays the values again with the
 * server's rules, so the shading, the spikes and the summary follow at once; the release saves it.
 * A chip chooses the interval the lines are drawn at, which changes nothing of the checks.
 */
import { IntervalChip } from '../dashboard/index.ts';
import styles from './alert-draft.module.css';
import { type Drawn, type DrawnOption, drawnNote } from './drawn-interval.ts';
import { type Replayed, summarize, summaryText } from './replay-model.ts';
import { TunableChart, type TunableChartProps } from './tunable-chart.tsx';

/** The windows a person picks from. */
export const draftWindows = ['24h', '7d'] as const;

/** A window of the replay. */
export type DraftWindow = (typeof draftWindows)[number];

/** What a replay load answers, as the alert pages' replay route returns it. */
export type ReplayOutcome =
  | { readonly ok: true; readonly replay: Replayed | { replayable: false; reason: string } }
  | { readonly ok: false; readonly message: string };

/**
 * The chart with the draggable threshold, and the summary under it.
 *
 * @param props - The replay, the spec, the series, the threshold and the callbacks.
 * @returns The chart and its summary.
 */
export function ReplayChart(props: Omit<TunableChartProps, 'label'>) {
  return (
    <>
      <TunableChart
        {...props}
        label={`${props.spec.title} as it would have fired, with its threshold`}
      />
      <p className={styles.summary} aria-live="polite">
        <strong>{summaryText(summarize(props.series))}</strong>
      </p>
      <p className={styles.note}>{drawnNote(props.interval ?? null, props.spec.every)}</p>
    </>
  );
}

/** Props of {@link ReplayHead}. */
interface ReplayHeadProps {
  /** The window shown. */
  readonly window: DraftWindow;
  /** Picks another window. */
  readonly onWindow: (window: DraftWindow) => void;
  /** What the dashed line is: the threshold, or the limit a change must reach; `null` for none. */
  readonly line: string | null;
  /** How the chart is drawn, once the replay is there. */
  readonly drawn: Drawn | undefined;
  /** Chooses the interval the chart is drawn at. */
  readonly onDrawn: (option: DrawnOption) => void;
}

/**
 * The buttons that pick the window of the replay.
 *
 * @param props - The window and its setter.
 * @returns The buttons.
 */
function WindowButtons({ window, onWindow }: Pick<ReplayHeadProps, 'window' | 'onWindow'>) {
  return (
    <span className={styles.windows}>
      {draftWindows.map((each) => (
        <button
          key={each}
          type="button"
          className={styles.window}
          aria-pressed={each === window}
          onClick={() => onWindow(each)}
        >
          {each === '7d' ? '7 d' : '24 h'}
        </button>
      ))}
    </span>
  );
}

/**
 * The replay card's title, legend, interval chip and window buttons.
 *
 * @param props - The window, its setter, the name of the dashed line and the chart's interval.
 * @returns The header.
 */
export function ReplayHead({ window, onWindow, line, drawn, onDrawn }: ReplayHeadProps) {
  const words = window === '7d' ? 'The last 7 days' : 'The last 24 hours';
  return (
    <div className={styles.cardHead}>
      <h3 className={styles.cardTitle}>{words}, as it would have fired</h3>
      <div className={styles.legend}>
        <span>
          <span className={styles.swatch} />
          firing
        </span>
        {line !== null && (
          <span>
            <span className={styles.dash} />
            {line}
          </span>
        )}
        <span>
          <span className={styles.spikeSwatch} />
          too short to fire
        </span>
        {drawn && <IntervalChip options={drawn.options} value={drawn.value} onChange={onDrawn} />}
        <WindowButtons window={window} onWindow={onWindow} />
      </div>
    </div>
  );
}
