/**
 * One agent run in a thread: takes the person's message, streams the model's answer with its tool
 * calls and custom parts, and stores the conversation when the run ends. The thread's state
 * machine, its token budget and the run limits are checked here, whatever the model does.
 */
import { resolveTime, threadDataSchemas } from '@querent/shared';
import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type LanguageModel,
  type StopCondition,
  streamText,
  type ToolSet,
  toUIMessageStream,
  validateUIMessages,
} from 'ai';
import { z } from 'zod';
import { AppError } from '../lib/errors.ts';
import type { ModelSettingsService } from '../settings/model-settings.ts';
import { buildTools, currentSpec } from './build-tools.ts';
import { dataTools } from './data-tools.ts';
import { languageModel, ModelUnavailableError } from './model.ts';
import { instructionsFor } from './prompt.ts';
import type { AgentServices, RunContext, ThreadMessage } from './run-context.ts';

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

/** Validates the metadata of a user message: the panels it mentions. */
const mentionsSchema = z.object({
  mentions: z.array(z.object({ panelId: z.string(), title: z.string() })).max(20),
});

/** New message ids. */
const newMessageId = createIdGenerator({ prefix: 'msg', size: 16 });

/**
 * Stops the run once it has made the allowed number of tool calls.
 *
 * @param limit - The most tool calls in a turn.
 * @returns The stop condition.
 */
function toolCallLimit(limit: number): StopCondition<ToolSet> {
  return ({ steps }) => steps.reduce((sum, step) => sum + step.toolCalls.length, 0) >= limit;
}

/**
 * The words a stream error shows the person.
 *
 * @param error - What failed.
 * @returns The message.
 */
function publicError(error: unknown): string {
  return error instanceof Error
    ? `The run failed: ${error.message.slice(0, 300)}`
    : 'The run failed.';
}

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
 * @returns The conversation to run on, and the mentions of the new message.
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
  const mentions =
    message.role === 'user'
      ? (mentionsSchema.safeParse(message.metadata).data?.mentions ?? [])
      : [];
  return { history: withIncoming(thread.messages, message), mentions, plans: thread.plans };
}

/**
 * The instructions of this turn.
 *
 * @param context - The run.
 * @param plans - The thread's plans.
 * @param mentions - The panels the person mentions.
 * @param now - The current instant.
 * @returns The instructions.
 */
function turnInstructions(
  context: RunContext,
  plans: ReturnType<AgentServices['threads']['get']>['plans'],
  mentions: readonly { panelId: string; title: string }[],
  now: number,
) {
  const spec = currentSpec(context);
  const { dashboardId, state } = context.threads.row(context.threadId);
  const version =
    dashboardId === null
      ? 0
      : (context.dashboards.get(dashboardId, 'editor').versions.at(-1)?.version ?? 0);
  const latest = plans.at(-1);
  return instructionsFor({
    now,
    connectors: context.modelView.connectors(),
    state,
    plan: latest ? { body: latest.body, status: latest.status } : undefined,
    draft: spec ? { version, spec } : undefined,
    mentions,
  });
}

/**
 * Streams one turn of the model into the writer.
 *
 * @param context - The run.
 * @param model - The model.
 * @param messages - The conversation.
 * @param instructions - The turn's instructions.
 * @param now - The clock.
 */
async function streamTurn(
  context: RunContext,
  model: LanguageModel,
  messages: ThreadMessage[],
  instructions: string,
  now: () => number,
) {
  const tools = {
    ...dataTools(context, (expression) => resolveTime(expression, now())),
    ...buildTools(context),
  };
  const { limits } = context.settings;
  const result = streamText({
    model,
    instructions,
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: [
      toolCallLimit(limits.toolCallsPerTurn),
      () => context.counters.planPending,
      () => context.counters.failedWrites >= limits.repairAttempts,
    ],
    abortSignal: context.signal,
    onEnd: ({ usage }) => context.threads.addTokens(context.threadId, usage.totalTokens ?? 0),
  });
  context.writer.merge(toUIMessageStream({ stream: result.stream, onError: publicError }));
}

/** A turn ready to stream: the model, the settings, the conversation and its context. */
interface PreparedTurn {
  /** The model. */
  readonly model: LanguageModel;
  /** The model settings. */
  readonly settings: RunContext['settings'];
  /** The conversation, validated. */
  readonly messages: ThreadMessage[];
  /** The panels the new message mentions. */
  readonly mentions: readonly { panelId: string; title: string }[];
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
  const { history, mentions, plans } = accept(dependencies, request, settings.limits.threadTokens);
  const messages = await validateUIMessages<ThreadMessage>({
    messages: history,
    dataSchemas: threadDataSchemas,
  });
  return { model, settings, messages, mentions, plans };
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
      const counters = { planPending: false, failedWrites: 0 };
      const { threadId, actor, signal } = request;
      const context: RunContext = {
        ...dependencies,
        threadId,
        actor,
        settings: turn.settings,
        writer,
        signal,
        counters,
      };
      const instructions = turnInstructions(context, turn.plans, turn.mentions, now());
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
