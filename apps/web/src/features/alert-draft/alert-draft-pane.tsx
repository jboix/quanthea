/**
 * The draft pane of an alert thread: the draft's title and version, Send a test notification and
 * Activate; the condition as a sentence of values to change; the replay with the threshold to
 * drag; the series; and whom it notifies with a preview per channel. Every change made here saves
 * a new draft version by hand, which the conversation shows and the agent reads.
 */
import type { AlertSpec, NotifiedSeries } from '@quanthea/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Pill } from '../../ui/pill.tsx';
import styles from './alert-draft.module.css';
import { ConditionSentence } from './condition-sentence.tsx';
import type { AlertDraftData, PreviewOutcome, PreviewRequest } from './data.ts';
import { Notifies } from './notifies.tsx';
import { byFiring, maxChartSeries, type Replayed, sampleFiring, seriesAt } from './replay-model.ts';
import {
  type DraftWindow,
  ReplayChart,
  ReplayHead,
  type ReplayOutcome,
} from './replay-section.tsx';
import { SeriesList } from './series-list.tsx';

/** What the pane tells the person after an action. */
export interface PaneNotice {
  /** The words. */
  readonly text: string;
  /** Whether it says what failed. */
  readonly failed: boolean;
}

/** Props of {@link AlertDraftPane}. */
export interface AlertDraftPaneProps {
  /** The thread. */
  readonly threadId: string;
  /** The draft, or `null` before the agent writes it. */
  readonly draft: AlertDraftData | null;
  /** Whether a run or an action is on its way, or the person may only read. */
  readonly busy: boolean;
  /** What the last action said, if anything. */
  readonly notice: PaneNotice | undefined;
  /** Saves the spec changed by hand as a new version. */
  readonly onHandEdit: (spec: AlertSpec) => void;
  /** Activates the version. */
  readonly onActivate: (alertId: string, version: number) => void;
  /** Sends the version's message to its channels as a test, filled from a series. */
  readonly onTest: (alertId: string, version: number, series: NotifiedSeries | null) => void;
}

/**
 * Loads the draft's replay over a window from the alert pages' replay route.
 *
 * @param draft - The draft.
 * @param window - The window.
 * @returns The outcome, once loaded.
 */
function useReplay(draft: AlertDraftData, window: DraftWindow): ReplayOutcome | undefined {
  const { load, data } = useFetcher<ReplayOutcome>({ key: `draft-replay-${draft.alert.id}` });
  const url = `/alerts/${draft.alert.id}/v/${draft.version}/replay?window=${window}`;
  useEffect(() => {
    void load(url);
  }, [load, url]);
  return data;
}

/**
 * Loads what each of the draft's channels would send, filled with a firing.
 *
 * @param threadId - The thread.
 * @param draft - The draft.
 * @param sample - The firing, once the replay is in.
 * @returns The previews, once loaded.
 */
function usePreviews(
  threadId: string,
  draft: AlertDraftData,
  sample: NotifiedSeries | null | undefined,
): PreviewOutcome | undefined {
  const { submit, data } = useFetcher<PreviewOutcome>({ key: `draft-previews-${threadId}` });
  const kinds = draft.spec.channels.flatMap(
    (id) => draft.channels.find((channel) => channel.id === id)?.kind ?? [],
  );
  const body = JSON.stringify({
    spec: draft.spec,
    alertId: draft.alert.id,
    series: sample ?? null,
    kinds,
  } satisfies PreviewRequest);
  const ready = sample !== undefined;
  // The body holds the firing, so a new firing asks again; an equal one does not.
  useEffect(() => {
    if (!ready) return;
    void submit(body, {
      method: 'post',
      action: `/threads/${threadId}/alert-previews`,
      encType: 'application/json',
    });
  }, [submit, body, threadId, ready]);
  return data;
}

/**
 * The pane's header: title, version, the test and Activate, and the alert page once active.
 *
 * @param props - The pane's props and the firing to test with.
 * @returns The header.
 */
function PaneHead(
  props: AlertDraftPaneProps & {
    readonly draft: AlertDraftData;
    readonly sample: NotifiedSeries | null;
  },
) {
  const { draft, busy } = props;
  const { alert, version, spec } = draft;
  const active = alert.activeVersion === version;
  return (
    <header className={styles.head}>
      <h2 className={styles.title}>{spec.title}</h2>
      <Pill tone={active ? 'ok' : 'draft'} mono>
        v{version} · {active ? 'active' : 'draft'}
      </Pill>
      <span className={styles.spacer} />
      <div className={styles.actions}>
        {alert.activeVersion !== null && (
          <Link className={styles.link} to={`/alerts/${alert.id}`}>
            Open the alert page
          </Link>
        )}
        <Button
          disabled={busy || spec.channels.length === 0}
          onClick={() => props.onTest(alert.id, version, props.sample)}
        >
          Send a test notification
        </Button>
        <Button
          variant="dark"
          disabled={busy || active}
          onClick={() => props.onActivate(alert.id, version)}
        >
          Activate
        </Button>
      </div>
    </header>
  );
}

/**
 * What stands in for the chart: loading, a failure, or why the draft can't be replayed.
 *
 * @param outcome - The replay's outcome, once loaded.
 * @returns The note, or nothing when the chart draws.
 */
function replayNote(outcome: ReplayOutcome | undefined): string | undefined {
  if (!outcome) return 'Running the query over the window…';
  if (!outcome.ok) return outcome.message;
  return outcome.replay.replayable ? undefined : outcome.replay.reason;
}

/**
 * The state of a written draft: the window, the replay, the threshold being dragged, the series
 * at that threshold, and a firing to fill the previews and the test with.
 *
 * @param draft - The draft.
 * @returns The state.
 */
function useDraftState(draft: AlertDraftData) {
  const { spec } = draft;
  const [window, setWindow] = useState<DraftWindow>('7d');
  const [dragged, setDragged] = useState<number | null>(null);
  const outcome = useReplay(draft, window);
  const replay: Replayed | undefined =
    outcome?.ok && outcome.replay.replayable ? outcome.replay : undefined;
  const threshold = dragged ?? (spec.condition.kind === 'threshold' ? spec.condition.value : null);
  const series = useMemo(
    () => (replay ? byFiring(seriesAt(replay, spec, threshold ?? 0)) : []),
    [replay, spec, threshold],
  );
  const drawn = useMemo(() => series.slice(0, maxChartSeries), [series]);
  // Undefined while the replay loads; null once it is known there is no firing to show.
  const noSample = outcome ? null : undefined;
  const sample = replay ? sampleFiring(replay) : noSample;
  return { window, setWindow, setDragged, outcome, replay, threshold, series, drawn, sample };
}

/** The pane's props for a written draft. */
type DraftProps = AlertDraftPaneProps & { readonly draft: AlertDraftData };

/**
 * The replay card: the chart with the threshold to drag, or what stands in for it.
 *
 * @param props - The pane's props and the draft's state.
 * @param props.state - The draft's state.
 * @returns The card.
 */
function ReplayCard(props: DraftProps & { readonly state: ReturnType<typeof useDraftState> }) {
  const { draft, busy, onHandEdit, state } = props;
  const { spec } = draft;
  const note = replayNote(state.outcome);
  const release = (value: number) => {
    state.setDragged(value);
    if (spec.condition.kind === 'threshold' && value !== spec.condition.value)
      onHandEdit({ ...spec, condition: { ...spec.condition, value } });
  };
  return (
    <section className={styles.card} aria-label="Replay">
      <ReplayHead window={state.window} onWindow={state.setWindow} />
      {state.replay && note === undefined ? (
        <ReplayChart
          replay={state.replay}
          spec={spec}
          series={state.series}
          drawn={state.drawn}
          threshold={state.threshold}
          disabled={busy}
          onMove={state.setDragged}
          onRelease={release}
        />
      ) : (
        <p className={styles.note}>{note}</p>
      )}
    </section>
  );
}

/**
 * The pane's body for a written draft.
 *
 * @param props - The pane's props and the draft.
 * @returns The header and the body.
 */
function DraftBody(props: DraftProps) {
  const { draft, busy, onHandEdit, notice } = props;
  const { spec } = draft;
  const state = useDraftState(draft);
  const previews = usePreviews(props.threadId, draft, state.sample);
  return (
    <>
      <PaneHead {...props} sample={state.sample ?? null} />
      <div className={styles.body}>
        {notice && (
          <p className={styles.notice} role="status" data-failed={notice.failed}>
            {notice.text}
          </p>
        )}
        <ConditionSentence
          spec={spec}
          threshold={state.threshold}
          disabled={busy}
          onChange={onHandEdit}
        />
        <ReplayCard {...props} state={state} />
        <div className={styles.grid}>
          <SeriesList spec={spec} series={state.series} />
          <Notifies
            spec={spec}
            channels={draft.channels}
            previews={previews}
            disabled={busy}
            onTemplate={(message) => onHandEdit({ ...spec, message })}
          />
        </div>
      </div>
    </>
  );
}

/**
 * The draft pane of an alert thread.
 *
 * @param props - The thread, the draft, the state and the actions.
 * @returns The pane.
 */
export function AlertDraftPane(props: AlertDraftPaneProps) {
  const { draft } = props;
  return (
    <section className={styles.pane} aria-label="Alert draft">
      {draft ? (
        <DraftBody key={`${draft.alert.id}-${draft.version}`} {...props} draft={draft} />
      ) : (
        <p className={styles.empty}>
          The alert appears here once the agent writes it: its condition, how it would have fired
          over the last week, and what each channel would receive.
        </p>
      )}
    </section>
  );
}
