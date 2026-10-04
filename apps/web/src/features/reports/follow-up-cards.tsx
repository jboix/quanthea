/**
 * What an answer about a run proposes to watch next: alerts and dashboards, each with the first
 * message of the conversation that would make it. Editors start that conversation, which opens with
 * the message in its box and sends nothing; others read the suggestion. Everything the model wrote
 * is shown as plain text.
 */
import { type FollowUp, hasRole } from '@quanthea/shared';
import { Link } from 'react-router';
import { buttonClassName } from '../../ui/button.tsx';
import { BellIcon, DashboardIcon } from '../../ui/icons.tsx';
import styles from './run-ask.module.css';
import { useRole } from './use-role.ts';

/** What each kind of card says, and the mode of the conversation it starts. */
const kinds = {
  alert: { label: 'An alert', start: 'Start this alert', icon: <BellIcon /> },
  dashboard: { label: 'A dashboard', start: 'Start this dashboard', icon: <DashboardIcon /> },
} as const;

/**
 * The new conversation a card starts, with its first message in the box.
 *
 * @param card - The card.
 * @returns Such as `/threads/new?make=alert&prompt=…`.
 */
export function startPath(card: FollowUp): string {
  const search = new URLSearchParams({ make: card.kind, prompt: card.prompt });
  return `/threads/new?${search.toString()}`;
}

/**
 * One card.
 *
 * @param props - The card and whether the person may start it.
 * @param props.card - The card.
 * @param props.canStart - Whether the person may start conversations: editors and above.
 * @returns The card.
 */
function FollowUpCard({ card, canStart }: { readonly card: FollowUp; readonly canStart: boolean }) {
  const kind = kinds[card.kind];
  return (
    <li className={styles.card}>
      <span className={styles.cardKind}>
        {kind.icon}
        {kind.label}
      </span>
      <span className={styles.cardTitle}>{card.title}</span>
      <p className={styles.cardPrompt}>{card.prompt}</p>
      {canStart && (
        <Link to={startPath(card)} className={buttonClassName('secondary', 'small')}>
          {kind.start}
        </Link>
      )}
    </li>
  );
}

/**
 * The cards of an answer, under the heading Worth watching.
 *
 * @param props - The cards.
 * @param props.cards - What the answer proposed, if anything.
 * @returns The list, or nothing without cards.
 */
export function FollowUpCards({ cards }: { readonly cards: readonly FollowUp[] | undefined }) {
  const role = useRole();
  if (!cards || cards.length === 0) return null;
  const canStart = hasRole(role, 'editor');
  return (
    <section className={styles.watching} aria-label="Worth watching">
      <h3 className={styles.watchingTitle}>Worth watching</h3>
      <ul className={styles.cards}>
        {cards.map((card) => (
          <FollowUpCard key={`${card.kind}:${card.title}`} card={card} canStart={canStart} />
        ))}
      </ul>
      {!canStart && <p className={styles.meta}>An editor can start these.</p>}
    </section>
  );
}
