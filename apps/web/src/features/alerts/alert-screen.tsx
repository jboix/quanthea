/**
 * An alert's page, laid out like a pinned dashboard: a header with its state, version and actions,
 * the chart of its query, each series now, what happened, and where it notifies.
 */
import type { AlertDetail } from '@quanthea/shared';
import { Link, useLoaderData } from 'react-router';
import { WarningIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import styles from './alert.module.css';
import { AlertChartCard } from './alert-chart-card.tsx';
import { ChangePopover, MutePopover } from './alert-menus.tsx';
import { Notifies, SeriesNow, WhatHappened } from './alert-sections.tsx';
import { VersionsPopover } from './alert-versions.tsx';
import type { AlertData } from './data.ts';
import { muteEnd, type StateTone, statePill } from './state-text.ts';
import { useAlertChange } from './use-alert-change.ts';

/** The pill tone of each state colour. */
const pillTone: Readonly<Record<StateTone, 'danger' | 'draft' | 'ok' | 'neutral'>> = {
  danger: 'danger',
  pending: 'draft',
  ok: 'ok',
  neutral: 'neutral',
};

/**
 * The version pill: the version shown, and whether it is active or a draft.
 *
 * @param props - The alert.
 * @param props.alert - The alert.
 * @returns The pill.
 */
function VersionPill({ alert }: { readonly alert: AlertDetail }) {
  if (alert.activeVersion === null)
    return (
      <Pill mono tone="draft">
        v{alert.latestVersion ?? 1} · draft
      </Pill>
    );
  return <Pill mono>v{alert.activeVersion} · active</Pill>;
}

/**
 * The header: where it sits, its title, state and version, and its actions.
 *
 * @param props - The alert and the current time.
 * @param props.alert - The alert.
 * @param props.now - The current time.
 * @returns The header.
 */
function AlertHeader({ alert, now }: { readonly alert: AlertDetail; readonly now: number }) {
  const state = statePill(alert, now);
  const where = alert.deactivated ? 'deactivated' : 'active';
  return (
    <header className={styles.header}>
      <div className={styles.headerText}>
        <nav aria-label="Breadcrumb" className={styles.crumbs}>
          <Link to="/alerts">Alerts</Link> / {alert.activeVersion === null ? 'draft' : where}
        </nav>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{alert.title}</h1>
          <Pill tone={pillTone[state.tone]}>
            <span className={styles.pillDot} data-tone={state.tone} />
            {state.text}
          </Pill>
          {alert.muted && <Pill>Muted {muteEnd(alert.muted.until, now)}</Pill>}
          <VersionPill alert={alert} />
        </div>
      </div>
      <div className={styles.headerActions}>
        <ChangePopover alert={alert} />
        <MutePopover alert={alert} />
        <VersionsPopover alert={alert} />
      </div>
    </header>
  );
}

/**
 * Why the last change was refused, under the header.
 *
 * @returns The note, or nothing.
 */
function Refusal() {
  const { refusal } = useAlertChange();
  if (!refusal) return null;
  return (
    <p className={styles.refusal} role="alert">
      <WarningIcon /> {refusal}
    </p>
  );
}

/**
 * The alert page.
 *
 * @returns The screen.
 */
export function AlertScreen() {
  const { alert } = useLoaderData() as AlertData;
  const now = Date.now();
  return (
    <div className={styles.screen}>
      <AlertHeader alert={alert} now={now} />
      <div className={styles.main}>
        <Refusal />
        <AlertChartCard alert={alert} />
        <div className={styles.columns}>
          <SeriesNow alert={alert} now={now} />
          <WhatHappened alert={alert} now={now} />
        </div>
        <Notifies alert={alert} now={now} />
      </div>
    </div>
  );
}
