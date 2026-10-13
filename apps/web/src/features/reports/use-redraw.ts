import type { ChartInterval, ReportRunDetail } from '@quanthea/shared';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { type RedrawOutcome, redrawPath } from './redraw-data.ts';

/**
 * The interval chosen for a run's charts and what the server drew for it. Going back to the stored
 * charts asks nothing, and another run starts from its stored charts.
 *
 * @param run - The run shown.
 * @returns The interval chosen, the charts drawn again once loaded, whether they load, why they
 *   could not be drawn, and the callback of the chip.
 */
export function useRedraw(run: ReportRunDetail) {
  const [chosen, setChosen] = useState<{ runId: string; interval: ChartInterval } | null>(null);
  const { load, data, state } = useFetcher<RedrawOutcome>({ key: `redraw-${run.id}` });
  const interval = chosen?.runId === run.id ? chosen.interval : null;
  const choose = (next: ChartInterval | null) => {
    setChosen(next && { runId: run.id, interval: next });
    if (next) void load(redrawPath(run.reportId, run.id, next));
  };
  const current = interval !== null && state === 'idle' ? data : undefined;
  const redraw = current?.ok && current.redraw.interval === interval ? current.redraw : undefined;
  return {
    interval,
    redraw,
    loading: interval !== null && state !== 'idle',
    failure: current && !current.ok ? current.message : undefined,
    choose,
  };
}
