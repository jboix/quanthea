/**
 * The person's side of the conversation: their words with the panels they mention, or the card of
 * a change they made by hand to the draft of a dashboard, an alert or a report.
 */
import type { ThreadData } from '@quanthea/shared';
import { HandEditCard } from './alert-cards.tsx';
import styles from './conversation.module.css';
import { DiffCard, type DiffCardProps } from './diff-card.tsx';
import type { ThreadMessage } from './messages.ts';

/** What a hand-edit card of the dashboard offers: Undo and Compare. */
export type HandEditActions = Pick<
  DiffCardProps,
  'latestVersion' | 'busy' | 'onUndo' | 'onCompare'
>;

/**
 * The card of a change the person made to a draft panel by hand: the diff, with Undo and Compare.
 *
 * @param props - The hand edit and the actions.
 * @param props.data - The hand edit.
 * @param props.actions - Undo and Compare, with the latest version.
 * @returns The card.
 */
function PanelHandEditCard({
  data,
  actions,
}: {
  readonly data: ThreadData['dashboardHandEdit'];
  readonly actions: HandEditActions;
}) {
  return <DiffCard diff={data} {...actions} byHand />;
}

/**
 * A person's message, with the panels it mentions.
 *
 * @param props - The message.
 * @param props.message - The user message.
 * @returns The bubble.
 */
function UserBubble({ message }: { readonly message: ThreadMessage }) {
  const text = message.parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n');
  const mentions = message.metadata?.mentions ?? [];
  let rest = text;
  for (const mention of mentions) rest = rest.replace(`@${mention.title}`, '');
  return (
    <div className={styles.user}>
      {mentions.map((mention) => (
        <span key={mention.panelId} className={styles.mention}>
          @{mention.title}
        </span>
      ))}
      {mentions.length > 0 ? ' ' : ''}
      {rest.trim()}
    </div>
  );
}

/**
 * The person's message: their words, or the card of a change they made to a draft by hand.
 *
 * @param props - The message and the hand-edit card's actions.
 * @param props.message - The user message.
 * @param props.actions - Undo and Compare, for a hand edit of the dashboard.
 * @returns The bubble or the card.
 */
export function PersonMessage({
  message,
  actions,
}: {
  readonly message: ThreadMessage;
  readonly actions: HandEditActions;
}) {
  const panels = message.parts.find((part) => part.type === 'data-dashboardHandEdit');
  if (panels?.type === 'data-dashboardHandEdit')
    return <PanelHandEditCard data={panels.data} actions={actions} />;
  const edit = message.parts.find(
    (part) => part.type === 'data-handEdit' || part.type === 'data-reportHandEdit',
  );
  if (edit?.type === 'data-handEdit' || edit?.type === 'data-reportHandEdit')
    return <HandEditCard data={edit.data} />;
  return <UserBubble message={message} />;
}
