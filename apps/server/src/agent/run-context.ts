/** What one agent run shares between its tools: the services, the thread, and its counters. */
import type {
  DefaultQuietHours,
  DefinitionVersion,
  ModelSettings,
  ThreadData,
  TurnUsage,
} from '@quanthea/shared';
import type { UIMessage, UIMessageStreamWriter } from 'ai';
import type { Alerts } from '../alerts/alerts.ts';
import type { PanelLinks } from '../alerts/links.ts';
import type { Dashboards } from '../dashboards/dashboards.ts';
import type { Definitions } from '../dashboards/definitions.ts';
import type { AvailableQueries } from '../dashboards/queries/index.ts';
import type { ModelConnector, ModelView } from '../gate/model-view.ts';
import type { Reports } from '../reports/reports.ts';
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
  /** The alerts, which alert threads write; alert threads refuse to run without them. */
  readonly alerts?: AlertAuthoring | undefined;
  /** The reports, which report threads write; report threads refuse to run without them. */
  readonly reports?: ReportAuthoring | undefined;
  /** The panels whose query matches an alert's, for the agent to propose linking. */
  readonly panelLinks?: Pick<PanelLinks, 'candidates'> | undefined;
  /** The notification channels an alert or a report may notify, by id, name and kind. */
  readonly channels?: (() => readonly ChannelChoice[]) | undefined;
  /** The quiet hours of the alerts that set none, from the alert settings; `null` for none. */
  readonly quietHours?: (() => DefaultQuietHours | null) | undefined;
  /**
   * The definitions of business terms as the model may read them: none that names a field hidden
   * from it. None when not given.
   */
  readonly modelDefinitions?: (() => readonly DefinitionVersion[]) | undefined;
  /**
   * Checks a definition as a save would and test-runs its bodies, saving nothing: for the
   * definitions the agent proposes. None when not given.
   */
  readonly checkDefinition?: Definitions['check'] | undefined;
}

/** What an alert thread needs of the alerts: check, save, replay and read a draft. */
export type AlertAuthoring = Pick<Alerts, 'check' | 'saveVersion' | 'replaySpec' | 'get'>;

/** What a report thread needs of the reports: preview a spec, save it, and read the draft. */
export type ReportAuthoring = Pick<Reports, 'preview' | 'saveVersion' | 'get'>;

/** A notification channel an alert or a report may notify. */
export interface ChannelChoice {
  /** The id the spec names. */
  readonly id: string;
  /** The name people know it by. */
  readonly name: string;
  /** The service, such as `slack`. */
  readonly kind: string;
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
  /** The definitions the run may build from, read once when it starts. */
  readonly definitions: readonly DefinitionVersion[];
  /** The chart recipes the agent is offered, by id. */
  readonly charts: readonly string[];
  /** Streams custom parts: plan cards, new versions, diffs. */
  readonly writer: UIMessageStreamWriter<ThreadMessage>;
  /** Aborted when the person stops the run or leaves. */
  readonly signal: AbortSignal;
  /** Counters the stop conditions read. */
  /** The connectors the run's tools and guide are about: all of them while the thread plans. */
  readonly inUse: readonly ModelConnector[];
  readonly counters: {
    /** Whether a plan now waits for approval, which ends the run. */
    planPending: boolean;
    /** Whether the agent asked the person a question, which ends the run. */
    asked: boolean;
    /** How many writes failed their checks or test runs in this run. */
    failedWrites: number;
    /** Whether the attempts are spent and the agent explains what failed, with no tools. */
    explaining: boolean;
    /** Whether the agent read the settings guide, which offers edit_settings from then on. */
    settingsRead: boolean;
    /** Whether the run builds an approved plan, which it may keep writing until the run ends. */
    buildingPlan: boolean;
    /** How many new panels this run saved, which bounds what it adds without a plan. */
    panelsAdded: number;
    /** The model the next step uses, for its usage. */
    modelId: string;
    /** The job the next step does, for the ledger. */
    job: string;
    /** The tokens spent so far, by model, the continued answer's included. */
    usage: TurnUsage;
  };
}
