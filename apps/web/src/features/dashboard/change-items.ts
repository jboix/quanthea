/** What the dashboard header's Change menu offers, by the dashboard's thread and the role. */
import type { DashboardPage } from '@quanthea/shared';

/** One entry of the Change menu. */
export type ChangeItem =
  /** Opens the thread that built the dashboard. */
  | { readonly kind: 'open-thread'; readonly threadId: string }
  /** Its thread is in the bin: opens the bin. */
  | { readonly kind: 'thread-in-bin' }
  /** It has no thread: starts one on the dashboard itself. */
  | { readonly kind: 'new-thread' }
  /** Starts a new thread on a copy of the version shown. */
  | { readonly kind: 'copy' };

/** What the Change menu needs to know about the dashboard's thread. */
type ThreadState = Pick<DashboardPage, 'threadId' | 'threadBinned' | 'threadOfOther'>;

/** The name of the item that edits the dashboard itself, whatever its thread's state. */
export const editWithAgent = 'Edit with the agent';

/** The name of the item that copies the version shown. */
export const newFromThis = 'New dashboard from this';

/** Each item's name and what it does. */
const itemWords: Readonly<Record<ChangeItem['kind'], { label: string; hint: string }>> = {
  'open-thread': { label: editWithAgent, hint: 'opens the conversation that built this dashboard' },
  'thread-in-bin': { label: editWithAgent, hint: 'its conversation is in the bin' },
  'new-thread': { label: editWithAgent, hint: 'starts a conversation about this dashboard' },
  copy: { label: newFromThis, hint: 'starts a new conversation from a copy' },
};

/**
 * The way to edit the dashboard itself, from the state of its thread.
 *
 * @param thread - The dashboard's thread state.
 * @returns The item, or `undefined` when the thread is someone else's, theirs to open.
 */
function editItem(thread: ThreadState): ChangeItem | undefined {
  if (thread.threadId !== null) return { kind: 'open-thread', threadId: thread.threadId };
  if (thread.threadOfOther) return undefined;
  if (thread.threadBinned) return { kind: 'thread-in-bin' };
  return { kind: 'new-thread' };
}

/**
 * The items of the Change menu: the way to edit the dashboard, when there is one, then a new
 * dashboard from the version shown. Viewers and analysts get none.
 *
 * @param thread - The dashboard's thread state.
 * @param canEdit - Whether the person is an editor or an admin.
 * @returns The items, in menu order.
 */
export function changeItems(thread: ThreadState, canEdit: boolean): ChangeItem[] {
  if (!canEdit) return [];
  const edit = editItem(thread);
  return edit ? [edit, { kind: 'copy' }] : [{ kind: 'copy' }];
}

/**
 * What a Change item says.
 *
 * @param item - The item.
 * @returns Its name, and the line under it on what it does.
 */
export function changeWords(item: ChangeItem): { label: string; hint: string } {
  return itemWords[item.kind];
}
