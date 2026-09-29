/**
 * The thread state machine. A thread asks, plans, waits for approval, builds and is ready; the
 * server checks every step here, whatever the model tries.
 *
 * ```
 * idle ──propose──▶ plan_pending ──approve──▶ building ──built──▶ ready
 *   ▲                    │ reject, or a new message                  │
 *   └────────────────────┘                        propose (a new plan)┘
 * ```
 */

/** Where a thread is. */
export type ThreadState = 'idle' | 'plan_pending' | 'building' | 'ready';

/** What moves a thread. */
export type ThreadEvent = 'propose' | 'approve' | 'reject' | 'built' | 'copied' | 'message';

/** The state each event leads to, from each state it is allowed in. */
const transitions: Readonly<Record<ThreadEvent, Partial<Record<ThreadState, ThreadState>>>> = {
  // A new plan replaces a pending one; after a build it starts the next change.
  propose: {
    idle: 'plan_pending',
    plan_pending: 'plan_pending',
    building: 'plan_pending',
    ready: 'plan_pending',
  },
  approve: { plan_pending: 'building' },
  reject: { plan_pending: 'idle' },
  // A small edit in a ready thread keeps it ready.
  built: { building: 'ready', ready: 'ready' },
  // Starting from a copy of a pinned dashboard gives a draft before any plan.
  copied: { idle: 'ready', plan_pending: 'ready' },
  // Replying to a pending plan supersedes it; a failed build stays building, so a retry needs no
  // new plan; a ready thread stays ready for small edits.
  message: { idle: 'idle', plan_pending: 'idle', building: 'building', ready: 'ready' },
};

/**
 * The state after an event.
 *
 * @param state - The current state.
 * @param event - The event.
 * @returns The next state, or `undefined` when the event is not allowed in this state.
 */
export function nextState(state: ThreadState, event: ThreadEvent): ThreadState | undefined {
  return transitions[event][state];
}

/**
 * Whether a thread may write a dashboard version: after an approved plan, or in a ready thread
 * when the change only touches existing panels.
 *
 * @param state - The thread state.
 * @param onlyExistingPanels - Whether the change leaves the set of panels as it is.
 * @returns Whether the write may go ahead.
 */
export function canWrite(state: ThreadState, onlyExistingPanels: boolean): boolean {
  return state === 'building' || (state === 'ready' && onlyExistingPanels);
}
