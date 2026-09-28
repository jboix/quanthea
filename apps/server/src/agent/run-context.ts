/** What one agent run shares between its tools: the services, the thread, and its counters. */
import type { ModelSettings, ThreadData } from '@querent/shared';
import type { UIMessage, UIMessageStreamWriter } from 'ai';
import type { Dashboards } from '../dashboards/dashboards.ts';
import type { ModelView } from '../gate/model-view.ts';
import type { Threads } from '../threads/threads.ts';

/** A thread message as the agent streams and stores it. */
export type ThreadMessage = UIMessage<{ tokens?: number }, ThreadData>;

/** The services the agent uses. It reaches data only through the model view, which is the gate. */
export interface AgentServices {
  /** The threads. */
  readonly threads: Threads;
  /** The dashboards. */
  readonly dashboards: Dashboards;
  /** The connectors as the model sees them. */
  readonly modelView: ModelView;
}

/** One run of the agent in one thread. */
export interface RunContext extends AgentServices {
  /** The thread. */
  readonly threadId: string;
  /** Who asked: recorded on the versions the run writes. */
  readonly actor: string;
  /** The model settings, for the limits and the behaviour. */
  readonly settings: ModelSettings;
  /** Streams custom parts: plan cards, new versions, diffs. */
  readonly writer: UIMessageStreamWriter<ThreadMessage>;
  /** Aborted when the person stops the run or leaves. */
  readonly signal: AbortSignal;
  /** Counters the stop conditions read. */
  readonly counters: {
    /** Whether a plan now waits for approval, which ends the run. */
    planPending: boolean;
    /** How many writes failed their checks or test runs in this run. */
    failedWrites: number;
  };
}
