/**
 * The alert page's sections below the chart: each series now, what happened, and where it
 * notifies with the latest messages sent.
 */
import type { AlertDetail, AlertState } from '@quanthea/shared';
import { Pill } from '../../ui/pill.tsx';
import styles from './alert.module.css';
import type { StateTone } from './state-text.ts';
import { timeline } from './timeline.ts';
import { clockWhen, durationSince, seriesName, stateWords, valueText } from './words.ts';

/** The colour of each state. */
const toneOf: Readonly<Record<AlertState, StateTone>> = {
  firing: 'danger',
  error: 'danger',
  pending: 'pending',
  ok: 'ok',
  no_data: 'neutral',
};

/** What each message sent says, in the latest messages. */
const sendWords: Readonly<Record<AlertDetail['sends'][number]['event'], string>> = {
  'alert.firing': 'Firing',
  'alert.resolved': 'Resolved',
  'alert.test': 'Test',
  'alert.error': 'Cannot be checked',
  'alert.recovered': 'Checked again',
};

/** How bad each state is, the worst first. */
const rank: Readonly<Record<AlertState, number>> = {
  firing: 0,
  pending: 1,
  error: 2,
  no_data: 3,
  ok: 4,
};

/**
 * Each series as the last evaluation left it, the worst first.
 *
 * @param props - The alert and the current time.
 * @param props.alert - The alert.
 * @param props.now - The current time.
 * @returns The card.
 */
export function SeriesNow({ alert, now }: { readonly alert: AlertDetail; readonly now: number }) {
  const series = [...alert.series].sort(
    (a, b) => rank[a.state] - rank[b.state] || a.key.localeCompare(b.key),
  );
  return (
    <section className={styles.card} aria-labelledby="alert-series-title">
      <h2 id="alert-series-title" className={styles.cardTitle}>
        Each series, now
      </h2>
      {series.length === 0 && <p className={styles.chartNote}>Not evaluated yet.</p>}
      <ul className={styles.seriesList}>
        {series.map((each) => {
          const state = `${stateWords[each.state]} ${durationSince(each.since, now)}`;
          return (
            <li key={each.key} className={styles.seriesRow}>
              <span className={styles.seriesName}>{seriesName(each.labels)}</span>
              <span className={styles.seriesState} data-tone={toneOf[each.state]}>
                <span className={styles.dot} data-tone={toneOf[each.state]} />
                {valueText(each.value, alert.format)} · {state}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * What happened, the latest first.
 *
 * @param props - The alert and the current time.
 * @param props.alert - The alert.
 * @param props.now - The current time.
 * @returns The card.
 */
export function WhatHappened({
  alert,
  now,
}: {
  readonly alert: AlertDetail;
  readonly now: number;
}) {
  const entries = timeline(alert, now);
  return (
    <section className={styles.card} aria-labelledby="alert-timeline-title">
      <h2 id="alert-timeline-title" className={styles.cardTitle}>
        What happened
      </h2>
      {entries.length === 0 && <p className={styles.chartNote}>Nothing yet.</p>}
      <ol className={styles.timeline}>
        {entries.map((entry) => (
          <li key={entry.key}>
            <time className={styles.when} dateTime={new Date(entry.at).toISOString()}>
              {clockWhen(entry.at, now)}
            </time>
            <span className={styles.dot} data-tone={entry.tone} />
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Where it notifies, by channel name and kind, and the latest messages sent about it.
 *
 * @param props - The alert and the current time.
 * @param props.alert - The alert.
 * @param props.now - The current time.
 * @returns The card.
 */
export function Notifies({ alert, now }: { readonly alert: AlertDetail; readonly now: number }) {
  return (
    <section className={styles.card} aria-labelledby="alert-notifies-title">
      <h2 id="alert-notifies-title" className={styles.cardTitle}>
        Notifies
      </h2>
      {alert.channels.length === 0 ? (
        <p className={styles.chartNote}>No channel: it notifies no one.</p>
      ) : (
        <ul className={styles.channels}>
          {alert.channels.map((channel) => (
            <li key={channel.id}>
              <span className={styles.channelName}>{channel.name}</span>
              <Pill shape="tag">{channel.kind}</Pill>
            </li>
          ))}
        </ul>
      )}
      <h3 className={styles.subheading}>Latest messages</h3>
      {alert.sends.length === 0 && <p className={styles.chartNote}>None sent yet.</p>}
      <ol className={styles.timeline}>
        {alert.sends.map((send) => (
          <li key={`${send.at}-${send.channel}-${send.seriesKey}`}>
            <time className={styles.when} dateTime={new Date(send.at).toISOString()}>
              {clockWhen(send.at, now)}
            </time>
            <span className={styles.dot} data-tone={send.ok ? 'ok' : 'danger'} />
            <span>
              {sendWords[send.event]} to {send.channel}
              {send.ok ? '' : ', failed'}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
