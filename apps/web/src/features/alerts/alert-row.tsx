/** One alert in the list: its state, title, condition, worst series and latest message. */
import type { AlertListItem } from '@quanthea/shared';
import { Link } from 'react-router';
import { StatusDot } from '../../ui/status-dot.tsx';
import styles from './alerts.module.css';
import { leadWords, rowState, type StateTone } from './state-text.ts';
import { clockWhen, conditionWords, valueText } from './words.ts';

/** The dot of each colour. */
const dotOf: Readonly<Record<StateTone, 'failed' | 'pending' | 'ok' | 'unknown'>> = {
  danger: 'failed',
  pending: 'pending',
  ok: 'ok',
  neutral: 'unknown',
};

/**
 * The right column of a row: the latest message sent, or who muted it.
 *
 * @param props - The alert and the current time.
 * @param props.alert - The alert.
 * @param props.now - The current time.
 * @returns The words.
 */
function LastWord({ alert, now }: { readonly alert: AlertListItem; readonly now: number }) {
  const sent = alert.lastNotification;
  if (alert.muted) return <span className={styles.aside}>muted by {alert.muted.by}</span>;
  if (!sent) return <span className={styles.aside}>no message sent yet</span>;
  const what = sent.ok ? 'notified' : 'failed to notify';
  return (
    <span className={styles.aside}>
      {sent.channel} · {what} {clockWhen(sent.at, now)}
    </span>
  );
}

/**
 * One row, a link to the alert's page.
 *
 * @param props - The alert and the current time.
 * @param props.alert - The alert.
 * @param props.now - The current time.
 * @returns The list item.
 */
export function AlertRow({ alert, now }: { readonly alert: AlertListItem; readonly now: number }) {
  const state = rowState(alert, now);
  const value = valueText(alert.lead?.value ?? null, alert.format);
  const words = [conditionWords(alert.condition, alert.format), ...leadWords(alert, value)];
  return (
    <li>
      <Link to={`/alerts/${alert.id}`} className={styles.row}>
        <span className={styles.state} data-tone={state.tone}>
          <StatusDot status={dotOf[state.tone]} label={state.text} />
          <span aria-hidden="true">{state.text}</span>
        </span>
        <span className={styles.what}>
          <span className={styles.title}>{alert.title}</span>
          <span className={styles.condition}>{words.join(' · ')}</span>
        </span>
        <LastWord alert={alert} now={now} />
      </Link>
    </li>
  );
}
