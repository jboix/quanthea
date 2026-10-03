/** The answering service's contract: what it needs, what it takes, and what it gives back. */
import type {
  Answer,
  AnswerData,
  AnswerEvidence,
  DashboardSpec,
  TurnUsage,
  VariableValues,
} from '@quanthea/shared';
import type { ModelMessage, UIMessage, UIMessageStreamWriter } from 'ai';
import type { Dashboards } from '../dashboards/dashboards.ts';
import type { ModelView } from '../gate/model-view.ts';
import type { ModelSettingsService, ResolvedModelSettings } from '../settings/model-settings.ts';
import type { Usage } from '../usage/usage.ts';
import type { AnswerToolContext } from './answer-tools.ts';
import type { languageModel } from './model.ts';

/** What the answering service needs. It reaches data only through the model view, the gate. */
export interface AnswerDependencies {
  /** The connectors as the model sees them. */
  readonly modelView: Pick<
    ModelView,
    'connectors' | 'describe' | 'describeSchemaOnly' | 'testQuery'
  >;
  /** The dashboards, to bind the viewer's variables as panels bind them. */
  readonly dashboards: Pick<Dashboards, 'bindVariables'>;
  /** The usage ledger. */
  readonly usage: Pick<Usage, 'recordStep'>;
  /** The model settings, for the provider, its key, the answer model and the limits. */
  readonly modelSettings: Pick<ModelSettingsService, 'resolve'>;
  /** Builds the model; the real providers by default. Tests pass a fake. */
  readonly buildModel?: typeof languageModel;
}

/** What every answer request names. */
interface RequestBase {
  /** The dashboard, for the usage ledger. */
  readonly dashboardId: string;
  /** The spec of the version asked about. */
  readonly spec: DashboardSpec;
  /** Who asks: the ledger records the steps against them. */
  readonly actor: string;
  /** The model provider; the default when left out. */
  readonly providerId?: string | null;
  /** Aborted when the person leaves. */
  readonly signal: AbortSignal;
}

/** A question about the data a dashboard shows. */
export interface AskRequest extends RequestBase {
  /** A question about the data. */
  readonly mode: 'ask';
  /** The range the person looks at, resolved to epoch milliseconds. */
  readonly time: { readonly from: number; readonly to: number };
  /** The dashboard's time zone, in which the answer names times. */
  readonly timeZone: string;
  /** The variables the person chose; defaults fill the rest. */
  readonly variables: VariableValues;
  /** The question. */
  readonly question: string;
  /** Earlier questions and answers this one follows up on, oldest first. */
  readonly history?: readonly { readonly question: string; readonly answer: string }[];
}

/** A request to explain a panel, with no data. */
export interface ExplainRequest extends RequestBase {
  /** An explanation, shown to every role. */
  readonly mode: 'explain';
  /** The panel to explain. */
  readonly panelId: string;
}

/** A request for an answer. */
export type AnswerRequest = AskRequest | ExplainRequest;

/** How an answer ended: checked, or why there is none. Either way, its reads and its tokens. */
export type AnswerOutcome =
  | { readonly ok: true; readonly answer: Answer; readonly usage: TurnUsage }
  | {
      readonly ok: false;
      readonly message: string;
      readonly evidence: readonly AnswerEvidence[];
      readonly usage: TurnUsage;
    };

/** An answer's message, as it streams: its usage in the metadata, reads and outcome as parts. */
export type AnswerMessage = UIMessage<{ usage?: TurnUsage }, AnswerData>;

/** The answering service. */
export interface Answers {
  /**
   * Answers a request.
   *
   * @param request - The question or the panel, and the dashboard.
   * @param writer - Streams the answer's parts as they come, when given.
   * @returns The outcome. A failing model call is a failed outcome, not a rejection.
   * @throws {AppError} `bad_request` when no model is set up or the range runs backwards,
   *   `not_found` for an unknown panel, and what binding the variables throws.
   */
  answer(
    request: AnswerRequest,
    writer?: UIMessageStreamWriter<AnswerMessage>,
  ): Promise<AnswerOutcome>;
  /**
   * Answers a request as a UI message stream, as the thread's chat streams: the model's tool
   * calls, a `data-evidence` part per read, a `data-outcome` part at the end, and the usage in
   * the message metadata.
   *
   * @param request - The question or the panel, and the dashboard.
   * @param onOutcome - Called with the outcome when the answer ends, to store it.
   * @returns The response.
   * @throws {AppError} As {@link Answers.answer}, before the stream starts.
   */
  stream(request: AnswerRequest, onOutcome: (outcome: AnswerOutcome) => void): Promise<Response>;
}

/** An answer ready to run: the model, its instructions, messages and tools, and its state. */
export interface PreparedAnswer {
  /** The request. */
  readonly request: AnswerRequest;
  /** The model settings and key. */
  readonly resolved: ResolvedModelSettings;
  /** The model. */
  readonly model: ReturnType<typeof languageModel>;
  /** The instructions. */
  readonly instructions: string;
  /** The conversation: earlier questions and answers, then this one. */
  readonly messages: ModelMessage[];
  /** The tools' context, with the state they fill. */
  readonly tools: AnswerToolContext;
  /** Where the reads stream, once the run has a writer. */
  readonly sink: { writer?: UIMessageStreamWriter<AnswerMessage> };
  /** The tokens spent so far, by model. */
  usage: TurnUsage;
  /** The tokens spent so far, in all. */
  tokens: number;
}
