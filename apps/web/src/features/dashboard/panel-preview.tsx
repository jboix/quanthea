import type { Panel, PanelRun } from '@querent/shared';
import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import type { Loaded } from './data.ts';
import { PanelView } from './panel-views.tsx';
import styles from './panels.module.css';

/** Props of {@link PanelPreview}. */
interface PanelPreviewProps {
  /** The dashboard. */
  readonly dashboardId: string;
  /** The pinned version. */
  readonly version: number;
  /** The panel to draw. */
  readonly panel: Panel;
  /** The dashboard's time zone, if it sets one. */
  readonly timeZone: string | undefined;
}

/**
 * Whether an element has come into view, once. Loading waits for it, so a long list of cards
 * runs only the queries someone scrolls to.
 *
 * @returns The element's ref, and whether it has been seen.
 */
function useSeen() {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);
  return { ref, seen };
}

/**
 * Why a preview has nothing to draw, if it has not.
 *
 * @param panel - The panel.
 * @param run - Its run, once it has finished.
 * @returns The note, or `undefined` when there is something to draw.
 */
function noteOf(panel: Panel, run: Loaded<PanelRun> | undefined): string | undefined {
  if (!run) return 'Loading…';
  if (!run.ok) return 'No preview.';
  const empty = run.value.queries.every((query) =>
    query.frames.every((frame) => frame.meta.rowCount === 0),
  );
  return empty && panel.view.kind !== 'stat' ? 'No data in this range.' : undefined;
}

/**
 * One panel of a pinned version drawn small, with its saved queries run once it comes into view.
 * It runs with no model, like the dashboard itself.
 *
 * @param props - The dashboard, its version, the panel and the time zone.
 * @returns The preview.
 */
export function PanelPreview({ dashboardId, version, panel, timeZone }: PanelPreviewProps) {
  const url = `/d/${dashboardId}/v/${version}/panels/${panel.id}`;
  const { load, data } = useFetcher<Loaded<PanelRun>>({ key: `preview-${url}` });
  const { ref, seen } = useSeen();
  useEffect(() => {
    if (seen) void load(url);
  }, [seen, load, url]);
  const note = noteOf(panel, data);
  return (
    <div ref={ref} className={styles.preview} data-kind={panel.view.kind}>
      {note !== undefined || !data?.ok ? (
        <p className={data ? styles.empty : styles.loading}>{note}</p>
      ) : (
        <PanelView
          panel={panel}
          queries={data.value.queries}
          markers={data.value.markers}
          timeZone={timeZone}
        />
      )}
    </div>
  );
}
