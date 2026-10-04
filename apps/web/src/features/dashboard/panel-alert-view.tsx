/**
 * What a panel shows of its alerts: a small state pill in its header that links to the alert, and
 * in its info bubble, Create an alert on this, the alerts that watch it, and the alerts whose query
 * matches its own. Viewers read; editors start alerts, link and dismiss.
 */
import type { PanelAlert } from '@quanthea/shared';
import { Link, type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { BellIcon } from '../../ui/icons.tsx';
import { MenuItem } from '../../ui/menu-item.tsx';
import { Pill } from '../../ui/pill.tsx';
import type { AlertIntent } from './alerts-data.ts';
import type { Loaded } from './loaded.ts';
import styles from './panel-alerts.module.css';
import {
  type PanelAlerts,
  type PillState,
  panelPill,
  pillState,
  type Selection,
} from './panel-alerts.ts';
import { useCanEdit } from './use-can-edit.ts';

/** What a panel knows of its alerts. */
export interface PanelAlertView {
  /** The alerts linked to it and suggested for it. */
  readonly alerts: PanelAlerts;
  /** The values the viewer chose. */
  readonly selection: Selection;
  /** The version shown, when it is pinned: an alert conversation starts from its panels. */
  readonly pinnedVersion: number | undefined;
}

/** The words and tone of each pill. */
const pills: Readonly<Record<PillState, { words: string; tone: 'danger' | 'draft' | 'neutral' }>> =
  {
    firing: { words: 'Firing', tone: 'danger' },
    pending: { words: 'Pending', tone: 'draft' },
    muted: { words: 'Muted', tone: 'neutral' },
  };

/**
 * The pill in a panel's header: the worst state of its alerts for the values chosen, linking to
 * the alert. Nothing when every alert is OK, so calm panels stay calm.
 *
 * @param props - The panel's alerts.
 * @param props.view - The panel's alerts and the values chosen.
 * @returns The pill, or nothing.
 */
export function PanelAlertPill({ view }: { readonly view: PanelAlertView }) {
  const pill = panelPill(view.alerts.linked, view.selection);
  if (!pill) return null;
  const { words, tone } = pills[pill.state];
  return (
    <Link
      to={`/alerts/${pill.alert.id}`}
      className={styles.pillLink}
      aria-label={`${pill.alert.title}: ${words.toLowerCase()}`}
      title={pill.alert.title}
    >
      <Pill tone={tone}>
        <BellIcon />
        {words}
      </Pill>
    </Link>
  );
}

/**
 * How an alert stands for the values chosen, in words.
 *
 * @param alert - The alert.
 * @param selection - The values chosen.
 * @returns Such as `firing`, `muted, firing` or `not active`.
 */
function stateWords(alert: PanelAlert, selection: Selection): string {
  if (!alert.evaluated) return 'not active';
  const state = pillState(alert, selection);
  if (state === 'muted') return 'muted, firing';
  return state ?? 'OK';
}

/**
 * Submits what the bubble asks to the dashboard's action.
 *
 * @returns The submit function, whether one is on its way, and the last outcome.
 */
function useAlertIntent() {
  const fetcher = useFetcher<Loaded<unknown>>();
  const submit = (intent: AlertIntent) =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.message : undefined;
  return { submit, busy: fetcher.state !== 'idle', failed };
}

/** Props of {@link PanelAlertSection}. */
interface PanelAlertSectionProps {
  /** The panel. */
  readonly panelId: string;
  /** What the panel knows of its alerts. */
  readonly view: PanelAlertView;
}

/**
 * The alerts part of a panel's info bubble: Create an alert on this for editors on a pinned
 * version, each alert that watches the panel with its state, and each suggested alert with Link
 * and Dismiss for editors.
 *
 * @param props - The panel and its alerts.
 * @returns The section, or nothing when it has nothing to say.
 */
export function PanelAlertSection({ panelId, view }: PanelAlertSectionProps) {
  const canEdit = useCanEdit();
  const { submit, busy, failed } = useAlertIntent();
  const { linked, suggested } = view.alerts;
  const creatable = canEdit && view.pinnedVersion !== undefined;
  const offered = canEdit ? suggested : [];
  if (!creatable && linked.length === 0 && offered.length === 0) return null;
  return (
    <div className={styles.section} data-busy={busy}>
      {creatable && (
        <div className={styles.create}>
          <MenuItem
            label="Create an alert on this"
            hint="starts an alert conversation with this query"
            disabled={busy}
            onClick={() =>
              submit({ intent: 'alertFromPanel', version: view.pinnedVersion ?? 0, panelId })
            }
          />
        </div>
      )}
      <WatchedBy alerts={linked} selection={view.selection} />
      {offered.map((alert) => (
        <SuggestedAlert
          key={alert.id}
          alert={alert}
          busy={busy}
          onLink={() => submit({ intent: 'linkAlert', alertId: alert.id, panelId })}
          onDismiss={() => submit({ intent: 'dismissAlert', alertId: alert.id, panelId })}
        />
      ))}
      {failed && <p className={styles.error}>{failed}</p>}
    </div>
  );
}

/**
 * The alerts that watch the panel, each with its state for the values chosen.
 *
 * @param props - The alerts and the values chosen.
 * @param props.alerts - The alerts linked to the panel.
 * @param props.selection - The values chosen.
 * @returns A line per alert.
 */
function WatchedBy({
  alerts,
  selection,
}: {
  readonly alerts: readonly PanelAlert[];
  readonly selection: Selection;
}) {
  return alerts.map((alert) => (
    <p key={alert.id} className={styles.line}>
      Watched by <Link to={`/alerts/${alert.id}`}>{alert.title}</Link>,{' '}
      {stateWords(alert, selection)}
    </p>
  ));
}

/** Props of {@link SuggestedAlert}. */
interface SuggestedAlertProps {
  /** The alert whose query matches the panel's. */
  readonly alert: PanelAlert;
  /** Whether a change is on its way. */
  readonly busy: boolean;
  /** Links it. */
  readonly onLink: () => void;
  /** Dismisses the suggestion. */
  readonly onDismiss: () => void;
}

/**
 * An alert whose query matches the panel's: Link or Dismiss.
 *
 * @param props - The alert, whether busy, and the callbacks.
 * @returns The suggestion.
 */
function SuggestedAlert({ alert, busy, onLink, onDismiss }: SuggestedAlertProps) {
  return (
    <div className={styles.suggestion}>
      <p className={styles.line}>
        An alert watches the same query: <Link to={`/alerts/${alert.id}`}>{alert.title}</Link>
      </p>
      <span className={styles.actions}>
        <Button size="small" variant="primary" disabled={busy} onClick={onLink}>
          Link
        </Button>
        <Button size="small" disabled={busy} onClick={onDismiss}>
          Dismiss
        </Button>
      </span>
    </div>
  );
}
