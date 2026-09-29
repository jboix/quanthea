/** What one agent run shares between its tools: the services, the thread, and its counters. */
import type { ModelSettings, ThreadData, TurnUsage } from '@querent/shared';
import type { UIMessage, UIMessageStreamWriter } from 'ai';
import type { Dashboards } from '../dashboards/dashboards.ts';
import type { AvailableQueries } from '../dashboards/queries/index.ts';
import type { ModelView } from '../gate/model-view.ts';
import type { Threads } from '../threads/threads.ts';
import type { Usage } from '../usage/usage.ts';

/** A thread message as the agent streams and stores it; an answer's metadata holds its usage. */
export type ThreadMessage = UIMessage<{ usage?: TurnUsage }, ThreadData>;

/** The services the agent uses. It reaches data only through the model view, which is the gate. */
export interface AgentServices {
  /** The threads. */
  readonly threads: Threads;
  /** The dashboards. */
  readonly dashboards: Dashboards;
  /** The connectors as the model sees them. */
  readonly modelView: ModelView;
  /** The usage ledger, which records every step. */
  readonly usage: Usage;
}

/** One run of the agent in one thread. */
export interface RunContext extends AgentServices {
  /** The thread. */
  readonly threadId: string;
  /** Who asked: recorded on the versions the run writes. */
  readonly actor: string;
  /** The name of the thread's model provider, for the usage ledger. */
  readonly providerName: string;
  /** The model settings, for the limits and the behaviour. */
  readonly settings: ModelSettings;
  /** The query builders and saved queries the thread may use. */
  readonly queries: AvailableQueries;
  /** The chart recipes the agent is offered, by id. */
  readonly charts: readonly string[];
  /** Streams custom parts: plan cards, new versions, diffs. */
  readonly writer: UIMessageStreamWriter<ThreadMessage>;
  /** Aborted when the person stops the run or leaves. */
  readonly signal: AbortSignal;
  /** Counters the stop conditions read. */
  readonly counters: {
    /** Whether a plan now waits for approval, which ends the run. */
    planPending: boolean;
    /** Whether the agent asked the person a question, which ends the run. */
    asked: boolean;
    /** How many writes failed their checks or test runs in this run. */
    failedWrites: number;
    /** The model the next step uses, for its usage. */
    modelId: string;
    /** The job the next step does, for the ledger. */
    job: string;
    /** The tokens spent so far, by model, the continued answer's included. */
    usage: TurnUsage;
  };
}
