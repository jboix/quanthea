/**
 * One agent run in a thread: takes the person's message, streams the model's answer with its tool
 * calls and custom parts, and stores the conversation when the run ends. The thread's state
 * machine, its token budget and the run limits are checked here, whatever the model does.
 */
import { threadDataSchemas } from '@querent/shared';
import {
  consumeStream,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type LanguageModel,
  type UIMessageStreamWriter,
  validateUIMessages,
} from 'ai';
import { z } from 'zod';
import { AppError } from '../lib/errors.ts';
import type { ModelSettingsService } from '../settings/model-settings.ts';
import { withPlanDecisions } from './compact.ts';
import { languageModel, ModelUnavailableError, modelIdFor } from './model.ts';
import type { AgentServices, RunContext, ThreadMessage } from './run-context.ts';
import { publicError, streamTurn, turnInstructions } from './turn.ts';
import { startingUsage } from './usage.ts';

/** What the agent needs. */
export interface AgentDependencies extends AgentServices {
  /** The model gateway settings. */
  readonly modelSettings: ModelSettingsService;
  /** Builds the model; the real providers by default. */
  readonly buildModel?: typeof languageModel;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** A chat request: the thread, the person's message, who they are. */
export interface ChatRequest {
  /** The thread. */
  readonly threadId: string;
  /** The new user message, or the assistant message to continue after an approval. */
  readonly message: unknown;
  /** Who asks. */
  readonly actor: string;
  /** Aborted when the person stops the run. */
  readonly signal: AbortSignal;
}

/** The agent. */
export interface Agent {
  /**
   * Runs the agent on a thread.
   *
   * @param request - The thread, the message, the person and the signal.
   * @returns The UI message stream response.
   * @throws {AppError} `bad_request` when no model is set up, the budget is spent, a run is going
   *   on, or the message is not one the thread can take.
   */
  chat(request: ChatRequest): Promise<Response>;
}

/** Validates the message a chat request carries. */
const incomingSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(['user', 'assistant']),
  parts: z.array(z.unknown()).max(100),
  metadata: z.unknown().optional(),
});

/** Validates the metadata of a user message: the panels it mentions, the person's time zone. */
const hintsSchema = z.object({
  mentions: z
    .array(z.object({ panelId: z.string(), title: z.string() }))
    .max(20)
    .default([]),
  timeZone: z.string().max(64).optional(),
});

/** What a user message tells the agent besides its text. */
type MessageHints = z.infer<typeof hintsSchema>;

/** New message ids. */
const newMessageId = createIdGenerator({ prefix: 'msg', size: 16 });

/**
 * Adds the incoming message to the history. A user message is appended (or replaces one with its
 * id); an assistant message may only name one already stored, to continue it, and the stored copy
 * is kept, so a client can never forge the agent's side.
 *
 * @param history - The stored conversation.
 * @param message - The incoming message.
 * @returns The conversation to run on.
 * @throws {AppError} `bad_request` for an assistant message the thread does not have.
 */
function withIncoming(
  history: readonly unknown[],
  message: z.infer<typeof incomingSchema>,
): unknown[] {
  const index = history.findIndex((stored) => (stored as { id?: unknown }).id === message.id);
  if (message.role === 'assistant') {
    if (index < 0) throw new AppError('bad_request', 'There is no such message to continue.');
    return [...history];
  }
  return index < 0
    ? [...history, message]
    : history.map((stored, at) => (at === index ? message : stored));
}

/**
 * The first text of a message, for a thread title.
 *
 * @param message - The message.
 * @returns At most 80 characters.
 */
function titleOf(message: z.infer<typeof incomingSchema>): string {
  const text = message.parts.find((part) => (part as { type?: unknown }).type === 'text') as
    | { text?: string }
    | undefined;
  return (text?.text ?? 'New thread').trim().slice(0, 80);
}

/**
 * Builds the model, or explains why it cannot.
 *
 * @param dependencies - The agent's dependencies.
 * @returns The model and the settings.
 */
async function modelFor(dependencies: AgentDependencies) {
  const resolved = await dependencies.modelSettings.resolve();
  try {
    return {
      model: (dependencies.buildModel ?? languageModel)(resolved, 'build'),
      settings: resolved.settings,
    };
  } catch (error) {
    if (error instanceof ModelUnavailableError) throw new AppError('bad_request', error.message);
    throw error;
  }
}

/**
 * Takes the person's message: checks the budget, moves the thread, and names it.
 *
 * @param dependencies - The agent's dependencies.
 * @param request - The chat request.
 * @param budget - The thread's token budget.
 * @returns The conversation to run on, the hints of the new message, and the thread's plans.
 */
function accept(dependencies: AgentDependencies, request: ChatRequest, budget: number) {
  const { threads } = dependencies;
  const thread = threads.get(request.threadId);
  if (thread.tokensUsed >= budget) {
    throw new AppError(
      'bad_request',
      `This thread has used its budget of ${budget.toLocaleString('en')} tokens. Start a new thread, or raise the limit in Settings → Model.`,
    );
  }
  const parsed = incomingSchema.safeParse(request.message);
  if (!parsed.success) throw new AppError('bad_request', 'The message is not a chat message.');
  const message = parsed.data;
  if (message.role === 'user') {
    threads.apply(request.threadId, 'message');
    threads.name(request.threadId, titleOf(message));
  }
  const parsedHints =
    message.role === 'user' ? hintsSchema.safeParse(message.metadata ?? {}) : undefined;
  const hints: MessageHints = parsedHints?.data ?? { mentions: [] };
  return { history: withIncoming(thread.messages, message), hints, plans: thread.plans };
}

/** A turn ready to stream: the model, the settings, the conversation and its context. */
interface PreparedTurn {
  /** The model. */
  readonly model: LanguageModel;
  /** The model settings. */
  readonly settings: RunContext['settings'];
  /** The conversation, validated. */
  readonly messages: ThreadMessage[];
  /** The panels the new message mentions, and the person's time zone. */
  readonly hints: MessageHints;
  /** The thread's plans. */
  readonly plans: ReturnType<AgentServices['threads']['get']>['plans'];
}

/**
 * Prepares a turn: the model, the accepted message, and the validated conversation.
 *
 * @param dependencies - The agent's dependencies.
 * @param request - The chat request.
 * @returns The prepared turn.
 */
async function prepare(
  dependencies: AgentDependencies,
  request: ChatRequest,
): Promise<PreparedTurn> {
  const { model, settings } = await modelFor(dependencies);
  const { history, hints, plans } = accept(dependencies, request, settings.limits.threadTokens);
  const validated = await validateUIMessages<ThreadMessage>({
    messages: history,
    dataSchemas: threadDataSchemas,
  });
  return { model, settings, messages: withPlanDecisions(validated, plans), hints, plans };
}

/**
 * The context of a run: the services, the thread, and fresh counters. A run that continues an
 * answer starts from that answer's usage.
 *
 * @param dependencies - The agent's dependencies.
 * @param request - The chat request.
 * @param turn - The prepared turn.
 * @param writer - The stream writer.
 * @returns The run context.
 */
function runContext(
  dependencies: AgentDependencies,
  request: ChatRequest,
  turn: PreparedTurn,
  writer: UIMessageStreamWriter<ThreadMessage>,
): RunContext {
  const continuing = (request.message as { role?: string }).role === 'assistant';
  const counters = {
    planPending: false,
    asked: false,
    failedWrites: 0,
    modelId: modelIdFor(turn.settings, 'build'),
    usage: startingUsage(turn.messages, continuing),
  };
  const { threadId, actor, signal } = request;
  return { ...dependencies, threadId, actor, settings: turn.settings, writer, signal, counters };
}

/**
 * Streams a prepared turn and stores the conversation when it ends.
 *
 * @param dependencies - The agent's dependencies.
 * @param request - The chat request.
 * @param turn - The prepared turn.
 * @param done - Called when the run ends, however it ends.
 * @returns The UI message stream response.
 */
function respond(
  dependencies: AgentDependencies,
  request: ChatRequest,
  turn: PreparedTurn,
  done: () => void,
): Response {
  const now = dependencies.now ?? Date.now;
  const stream = createUIMessageStream<ThreadMessage>({
    originalMessages: turn.messages,
    generateId: newMessageId,
    execute: async ({ writer }) => {
      const context = runContext(dependencies, request, turn, writer);
      const instructions = await turnInstructions(context, turn.plans, turn.hints, now());
      await streamTurn(context, turn.model, turn.messages, instructions, now);
    },
    onEnd: ({ messages }) => {
      done();
      dependencies.threads.saveMessages(request.threadId, messages, request.actor);
    },
    onError: publicError,
  });
  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: ({ stream: sse }) => consumeStream({ stream: sse }),
  });
}

/**
 * Creates the agent.
 *
 * @param dependencies - The services, the model settings, and optionally a model builder.
 * @returns The agent.
 */
export function createAgent(dependencies: AgentDependencies): Agent {
  const running = new Set<string>();
  return {
    async chat(request) {
      if (running.has(request.threadId)) {
        throw new AppError('bad_request', 'The agent is already working in this thread.');
      }
      const turn = await prepare(dependencies, request);
      running.add(request.threadId);
      return respond(dependencies, request, turn, () => running.delete(request.threadId));
    },
  };
}
