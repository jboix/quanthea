/**
 * An alert's page, laid out like a pinned dashboard: a header with its state, whether it is muted
 * or in its quiet hours, its version and actions, the chart of its query, each series now, what
 * happened, the panels it is shown on, and where it notifies.
 */
import type { AlertDetail } from '@quanthea/shared';
import { useState } from 'react';
import { Link, useLoaderData } from 'react-router';
import { WarningIcon } from '../../ui/icons.tsx';
import { Pill } from '../../ui/pill.tsx';
import { TitleHeader } from '../../ui/title-header.tsx';
import { quietSummary } from '../alert-draft/index.ts';
import styles from './alert.module.css';
import { HeaderActions } from './alert-actions.tsx';
import { AlertChartCard, useAlertReplay, windows } from './alert-chart-card.tsx';
import { Notifies, SeriesNow, shownSpec, WhatHappened } from './alert-sections.tsx';
import type { AlertData, ReplayWindow } from './data.ts';
import { ShownOnCard } from './shown-on.tsx';
import { muteEnd, type StateTone, statePill } from './state-text.ts';
import { UnsavedBar } from './unsaved-bar.tsx';
import { useAlertChange } from './use-alert-change.ts';
import { useTuning } from './use-tuning.ts';
import { clockWhen } from './words.ts';

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
 * The pill that says an alert being evaluated is in its quiet hours, and until when.
 *
 * @param props - The alert and the current time.
 * @param props.alert - The alert.
 * @param props.now - The current time.
 * @returns The pill, or nothing outside quiet hours.
 */
function QuietPill({ alert, now }: { readonly alert: AlertDetail; readonly now: number }) {
  const spec = shownSpec(alert);
  if (!spec || alert.activeVersion === null || alert.deactivated) return null;
  const { quiet, quietUntil } = quietSummary(spec, alert.defaultQuietHours, now);
  if (!quiet) return null;
  const until = quietUntil === null ? '' : ` until ${clockWhen(quietUntil, now)}`;
  return <Pill>Quiet hours{until}</Pill>;
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
    <TitleHeader
      className={styles.header}
      level={1}
      size="screen"
      align="end"
      title={alert.title}
      eyebrow={
        <nav aria-label="Breadcrumb">
          <Link to="/alerts">Alerts</Link> / {alert.activeVersion === null ? 'draft' : where}
        </nav>
      }
      badges={
        <>
          <Pill tone={pillTone[state.tone]}>
            <span className={styles.pillDot} data-tone={state.tone} />
            {state.text}
          </Pill>
          {alert.muted && <Pill>Muted {muteEnd(alert.muted.until, now)}</Pill>}
          <QuietPill alert={alert} now={now} />
          <VersionPill alert={alert} />
        </>
      }
      actions={<HeaderActions alert={alert} />}
    />
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
  const { alert, links } = useLoaderData() as AlertData;
  const now = Date.now();
  const [window, setWindow] = useState<ReplayWindow>('24h');
  const outcome = useAlertReplay(alert, window);
  const tuning = useTuning(alert);
  const name = windows.find((each) => each.id === window)?.name ?? window;
  return (
    <div className={styles.screen}>
      <AlertHeader alert={alert} now={now} />
      <UnsavedBar alert={alert} tuning={tuning} outcome={outcome} window={name} />
      <div className={styles.main}>
        <Refusal />
        <AlertChartCard
          alert={alert}
          tuning={tuning}
          window={window}
          onWindow={setWindow}
          outcome={outcome}
        />
        <div className={styles.columns}>
          <SeriesNow alert={alert} now={now} />
          <WhatHappened alert={alert} now={now} />
        </div>
        <ShownOnCard links={links} />
        <Notifies alert={alert} now={now} />
      </div>
    </div>
  );
}
