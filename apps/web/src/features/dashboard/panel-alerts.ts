/**
 * What the alerts linked to a panel show for the variables the viewer chose. A series counts when
 * each of its labels named like a variable holds a chosen value; a variable on All, or one no label
 * is named like, filters nothing, so the panel shows the worst state of every series. An alert
 * whose fixed variables take none of the chosen values watches something else, and shows nothing.
 */
import {
  createFormatter,
  type DashboardAlerts,
  type DashboardSpec,
  type PanelAlert,
} from '@quanthea/shared';
import type { AlertMarks } from '../../charts/input.ts';
import type { ViewChoices } from './view-state.ts';

/** The state a panel's pill shows: firing, pending, or muted while firing. */
export type PillState = 'firing' | 'pending' | 'muted';

/** The alerts of one panel. */
export interface PanelAlerts {
  /** The alerts linked to it. */
  readonly linked: readonly PanelAlert[];
  /** The alerts whose query matches its own, not linked: for editors. */
  readonly suggested: readonly PanelAlert[];
}

/** The chosen values of each variable that filters: by name. */
export type Selection = ReadonlyMap<string, readonly string[]>;

/** The value that stands for every option of a variable. */
const allValue = '$__all';

/** The prefix of the id of an alert's firing periods among the sets of markers. */
export const alertSetPrefix = 'alert:';

/**
 * The id of an alert's firing periods among the sets of markers, which the viewer hides with the
 * same URL parameter. A set's own id is a slug, so it never starts like this.
 *
 * @param alertId - The alert.
 * @returns The id.
 */
export function alertSetId(alertId: string): string {
  return `${alertSetPrefix}${alertId}`;
}

/**
 * The values the viewer chose, or the defaults, of each variable that filters.
 *
 * @param spec - The spec, for its variables and their defaults.
 * @param choices - The viewer's choices.
 * @returns The values by variable name; a variable on All is left out.
 */
export function selectionOf(spec: DashboardSpec, choices: ViewChoices): Selection {
  const entries = spec.variables.flatMap((variable) => {
    if (variable.kind === 'interval') return [];
    const value = choices.variables[variable.name] ?? variable.default;
    const values = value === undefined ? [] : [value].flat();
    if (values.length === 0 || values.includes(allValue)) return [];
    return [[variable.name, values] as const];
  });
  return new Map(entries);
}

/**
 * Whether labels hold the chosen values.
 *
 * @param labels - A series' labels.
 * @param selection - The chosen values.
 * @returns `true` when every label named like a filtering variable holds one of its values.
 */
function inSelection(labels: Readonly<Record<string, string>>, selection: Selection): boolean {
  return Object.entries(labels).every(([name, value]) => {
    const chosen = selection.get(name);
    return chosen === undefined || chosen.includes(value);
  });
}

/**
 * Whether an alert watches what the viewer chose: its fixed variables take a chosen value.
 *
 * @param alert - The alert.
 * @param selection - The chosen values.
 * @returns Whether it does.
 */
function watches(alert: PanelAlert, selection: Selection): boolean {
  return alert.variables.every(({ name, value }) => {
    const chosen = selection.get(name);
    return chosen === undefined || [value].flat().some((each) => chosen.includes(each));
  });
}

/**
 * The state of the alert's series the selection shows, for the panel's pill.
 *
 * @param alert - The alert.
 * @param selection - The chosen values.
 * @returns Firing, pending, muted while firing, or `null` to show nothing.
 */
export function pillState(alert: PanelAlert, selection: Selection): PillState | null {
  if (!alert.evaluated || !watches(alert, selection)) return null;
  const states = alert.series
    .filter((series) => inSelection(series.labels, selection))
    .map((series) => series.state);
  if (states.includes('firing')) return alert.muted ? 'muted' : 'firing';
  return states.includes('pending') && !alert.muted ? 'pending' : null;
}

/**
 * The worst pill of a panel's alerts, and the alert it stands for.
 *
 * @param alerts - The alerts linked to the panel.
 * @param selection - The chosen values.
 * @returns The pill, or `undefined` when every alert is calm.
 */
export function panelPill(
  alerts: readonly PanelAlert[],
  selection: Selection,
): { readonly state: PillState; readonly alert: PanelAlert } | undefined {
  const order: readonly PillState[] = ['firing', 'pending', 'muted'];
  const pills = alerts.flatMap((alert) => {
    const state = pillState(alert, selection);
    return state === null ? [] : [{ state, alert }];
  });
  return pills.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))[0];
}

/**
 * The periods the alert fired in the series the selection shows; one still firing ends now.
 *
 * @param alert - The alert.
 * @param selection - The chosen values.
 * @param now - The current instant.
 * @returns The periods.
 */
function periodsInView(alert: PanelAlert, selection: Selection, now: number) {
  if (!watches(alert, selection)) return [];
  return alert.periods
    .filter((period) => inSelection(period.labels, selection))
    .map((period) => ({ from: period.from, to: period.to ?? now }));
}

/**
 * What the alerts linked to a panel draw on its time chart: their thresholds, and the firing
 * periods of the alerts whose set the viewer did not hide.
 *
 * @param alerts - The alerts linked to the panel.
 * @param selection - The chosen values.
 * @param hidden - The ids of the sets of markers the viewer hid.
 * @param now - The current instant.
 * @returns The marks, or `undefined` when there are none.
 */
export function alertMarksOf(
  alerts: readonly PanelAlert[],
  selection: Selection,
  hidden: ReadonlySet<string>,
  now: number,
): AlertMarks | undefined {
  const evaluated = alerts.filter((alert) => alert.evaluated && watches(alert, selection));
  const thresholds = evaluated.flatMap(({ threshold, format }) => {
    if (threshold === null) return [];
    const label = format ? createFormatter(format)(threshold.value) : String(threshold.value);
    return [{ value: threshold.value, label }];
  });
  const periods = evaluated
    .filter((alert) => !hidden.has(alertSetId(alert.id)))
    .flatMap((alert) => periodsInView(alert, selection, now));
  if (thresholds.length === 0 && periods.length === 0) return undefined;
  return { thresholds, periods };
}

/**
 * The alerts of one panel.
 *
 * @param data - The alerts on the dashboard's panels, once loaded.
 * @param panelId - The panel.
 * @returns The alerts linked to it and suggested for it.
 */
export function panelAlertsOf(data: DashboardAlerts | undefined, panelId: string): PanelAlerts {
  const byId = new Map((data?.alerts ?? []).map((alert) => [alert.id, alert]));
  const pick = (pairs: DashboardAlerts['links']) =>
    pairs.flatMap((pair) => {
      const alert = pair.panelId === panelId ? byId.get(pair.alertId) : undefined;
      return alert ? [alert] : [];
    });
  return { linked: pick(data?.links ?? []), suggested: pick(data?.suggestions ?? []) };
}

/**
 * The alerts linked to some panel, each once, in the order the server lists them: the variables row
 * toggles their firing periods.
 *
 * @param data - The alerts on the dashboard's panels, once loaded.
 * @returns The alerts.
 */
export function linkedAlertsOf(data: DashboardAlerts | undefined): PanelAlert[] {
  const ids = new Set((data?.links ?? []).map((link) => link.alertId));
  return (data?.alerts ?? []).filter((alert) => ids.has(alert.id));
}

/** A state as the list shows it: words and a pill tone. */
interface ListedState {
  /** The words. */
  readonly words: string;
  /** The pill's tone. */
  readonly tone: 'danger' | 'draft' | 'ok' | 'neutral';
}

/**
 * How an alert stands as a whole: its worst series, muted or not evaluated.
 *
 * @param alert - The alert.
 * @returns The state.
 */
export function listedState(alert: PanelAlert): ListedState {
  if (!alert.evaluated) return { words: 'Not active', tone: 'neutral' };
  const states = new Set(alert.series.map((series) => series.state));
  if (states.has('firing'))
    return alert.muted
      ? { words: 'Muted, firing', tone: 'neutral' }
      : { words: 'Firing', tone: 'danger' };
  if (states.has('pending')) return { words: 'Pending', tone: 'draft' };
  return alert.muted ? { words: 'Muted', tone: 'neutral' } : { words: 'OK', tone: 'ok' };
}
