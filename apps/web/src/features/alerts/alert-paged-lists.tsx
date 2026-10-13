/**
 * The lists of the alert page that grow without limit, a page at a time, the latest first: what
 * happened, and the messages sent. The alert carries the first page of each; Older loads the next.
 */
import type { AlertDetail } from '@quanthea/shared';
import { Pager } from '../../ui/pager.tsx';
import styles from './alert.module.css';
import { type TimelineEntry, timeline } from './timeline.ts';
import { type Pages, usePages } from './use-pages.ts';
import { clockWhen } from './words.ts';

/** A message sent about the alert. */
type AlertSend = AlertDetail['sends']['sends'][number];

/** What each message sent says, in the latest messages. */
const sendWords: Readonly<Record<AlertSend['event'], string>> = {
  'alert.firing': 'Firing',
  'alert.resolved': 'Resolved',
  'alert.test': 'Test',
  'alert.error': 'Cannot be checked',
  'alert.recovered': 'Checked again',
};

/** Props of {@link PagedLines}. */
interface PagedLinesProps {
  /** The lines of the page shown. */
  readonly lines: readonly TimelineEntry[];
  /** The place of the page in its list, and its controls. */
  readonly pages: Pages<{ readonly total: number; readonly offset: number }>;
  /** What the pages are of, for assistive technology. */
  readonly label: string;
  /** What an empty list says. */
  readonly empty: string;
  /** The current time. */
  readonly now: number;
}

/**
 * One page of dated lines, with its pager.
 *
 * @param props - The lines, the place of the page and its controls.
 * @returns The list and the pager.
 */
function PagedLines({ lines, pages, label, empty, now }: PagedLinesProps) {
  const { page, busy, failure } = pages;
  return (
    <>
      {lines.length === 0 && <p className={styles.chartNote}>{empty}</p>}
      <ol className={styles.timeline} aria-busy={busy}>
        {lines.map((line) => (
          <li key={line.key}>
            <time className={styles.when} dateTime={new Date(line.at).toISOString()}>
              {clockWhen(line.at, now)}
            </time>
            <span className={styles.dot} data-tone={line.tone} />
            <span>{line.text}</span>
          </li>
        ))}
      </ol>
      {failure && (
        <p className={styles.chartNote} role="alert">
          The older entries did not load: {failure}
        </p>
      )}
      <Pager
        {...{ label, busy, offset: page.offset, shown: lines.length, total: page.total }}
        onNewer={pages.onNewer}
        onOlder={pages.onOlder}
      />
    </>
  );
}

/**
 * What happened, the latest first, ten entries at a time.
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
  const pages = usePages(alert.timeline, `/alerts/${encodeURIComponent(alert.id)}/timeline`);
  return (
    <section className={styles.card} aria-labelledby="alert-timeline-title">
      <h2 id="alert-timeline-title" className={styles.cardTitle}>
        What happened
      </h2>
      <PagedLines
        lines={timeline(pages.page.entries, alert, now)}
        pages={pages}
        label="What happened, pages"
        empty="Nothing yet."
        now={now}
      />
    </section>
  );
}

/**
 * A message sent as a line.
 *
 * @param send - The message.
 * @returns The line.
 */
export function sendLine(send: AlertSend): TimelineEntry {
  const text = `${sendWords[send.event]} to ${send.channel}${send.ok ? '' : ', failed'}`;
  return { key: send.id, at: send.at, text, tone: send.ok ? 'ok' : 'danger' };
}

/**
 * The messages sent about the alert, the latest first, ten at a time.
 *
 * @param props - The alert and the current time.
 * @param props.alert - The alert.
 * @param props.now - The current time.
 * @returns The heading and the list.
 */
export function LatestMessages({
  alert,
  now,
}: {
  readonly alert: AlertDetail;
  readonly now: number;
}) {
  const pages = usePages(alert.sends, `/alerts/${encodeURIComponent(alert.id)}/sends`);
  return (
    <>
      <h3 className={styles.subheading}>Latest messages</h3>
      <PagedLines
        lines={pages.page.sends.map(sendLine)}
        pages={pages}
        label="Latest messages, pages"
        empty="None sent yet."
        now={now}
      />
    </>
  );
}
