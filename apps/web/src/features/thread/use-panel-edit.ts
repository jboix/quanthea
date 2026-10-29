/**
 * The state of a hand edit of one draft panel, shared by the inspector's form and JSON tabs: the
 * panel as the person leaves it, a chart picked from the recipes, the test run and the save.
 */
import type { HandChart, Panel, PanelEdit, PanelTestOutcome } from '@quanthea/shared';
import { useState } from 'react';
import { type SubmitTarget, useFetcher } from 'react-router';
import type { PanelEditRequest, PanelSaveResult, PanelTestResult } from './panel-edit-data.ts';
import { differs } from './panel-edit-model.ts';

/** Where the edit goes: the thread, the version it starts from, and the panel as it is. */
export interface PanelEditTarget {
  /** The thread. */
  readonly threadId: string;
  /** The latest version, which the edit starts from. */
  readonly basedOn: number;
  /** The panel as the version has it. */
  readonly panel: Panel;
}

/** A hand edit in progress. */
export interface PanelEditState {
  /** The panel as the person leaves it. */
  readonly draft: Panel;
  /** Replaces the panel. */
  readonly setDraft: (panel: Panel) => void;
  /** The chart picked from the recipes, if any. */
  readonly chart: HandChart | undefined;
  /** Picks a chart, or keeps the panel's own with `undefined`. */
  readonly setChart: (chart: HandChart | undefined) => void;
  /** Whether the edit changes anything. */
  readonly changed: boolean;
  /** The test run of the edit as it stands, once one ran. */
  readonly tested: PanelTestOutcome | undefined;
  /** Why the test run or the save was refused, with the problems a save lists. */
  readonly refusal: Extract<PanelSaveResult, { ok: false }> | undefined;
  /** Whether the edit may be saved: it changes something, and a changed query ran. */
  readonly savable: boolean;
  /** Whether a test run or a save is on its way. */
  readonly busy: boolean;
  /** Test-runs the edit. */
  readonly run: () => void;
  /** Saves the edit. */
  readonly save: () => void;
}

/**
 * The refusal to show: the save's, else a test run that could not run.
 *
 * @param saved - The save's outcome, if any.
 * @param tested - The test run's outcome, if any.
 * @returns The refusal, if any.
 */
function refusalOf(
  saved: PanelSaveResult | undefined,
  tested: PanelTestResult | undefined,
): PanelEditState['refusal'] {
  if (saved && !saved.ok) return saved;
  return tested && !tested.ok ? { ...tested, issues: [] } : undefined;
}

/**
 * Posts an edit to a route of the inspector's hand edits, as JSON.
 *
 * @param submit - The fetcher's submit.
 * @param action - The route.
 * @param request - The panel and the edit.
 */
function submitEdit(
  submit: ReturnType<typeof useFetcher>['submit'],
  action: string,
  request: PanelEditRequest,
): void {
  void submit(request as unknown as SubmitTarget, {
    method: 'post',
    action,
    encType: 'application/json',
  });
}

/**
 * The state of a hand edit. Key the component by the panel and the version, so a new version
 * starts a fresh edit.
 *
 * @param target - The thread, the version and the panel.
 * @returns The state.
 */
export function usePanelEdit(target: PanelEditTarget): PanelEditState {
  const [draft, setDraft] = useState(target.panel);
  const [chart, setChart] = useState<HandChart | undefined>();
  const [testedKey, setTestedKey] = useState<string>();
  const tester = useFetcher<PanelTestResult>();
  const saver = useFetcher<PanelSaveResult>();
  const edit: PanelEdit = { basedOn: target.basedOn, panel: draft, ...(chart ? { chart } : {}) };
  const key = JSON.stringify(edit);
  const submit = (fetcher: typeof tester | typeof saver, route: string) =>
    submitEdit(fetcher.submit, `/threads/${target.threadId}/${route}`, {
      panelId: target.panel.id,
      edit,
    });
  const tested = tester.data?.ok && testedKey === key ? tester.data.outcome : undefined;
  const changed = differs(target.panel, draft) || chart !== undefined;
  const ran = !differs(target.panel.queries, draft.queries) || tested?.ok === true;
  const busy = tester.state !== 'idle' || saver.state !== 'idle';
  return {
    ...{ draft, setDraft, chart, setChart, changed, tested, busy },
    refusal: refusalOf(saver.data, tester.data),
    savable: changed && ran && !busy,
    run: () => {
      setTestedKey(key);
      submit(tester, 'panel-test');
    },
    save: () => submit(saver, 'panel-edit'),
  };
}
