/**
 * Answers about a dashboard version, outside any thread. `ask` answers a question about the data
 * over a time range, reading through the gate only on connectors whose access level shows numbers.
 * `explain` says what one panel measures from the spec and the schema alone, with no data, so its
 * text can be shown to every role. The answer is a `give_answer` call whose citations the server
 * checks; it gets one repair try. The model's steps are in `answer-steps.ts`; every one is recorded
 * in the usage ledger against who asked.
 */
import type { DashboardSpec } from '@quanthea/shared';
import {
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type UIMessageStreamWriter,
} from 'ai';
import { AppError } from '../lib/errors.ts';
import { stallMessage } from './answer-ending.ts';
import { type AnswerConnector, askInstructions, explainInstructions } from './answer-prompt.ts';
import { runInstructions } from './answer-run-prompt.ts';
import { answerTries, type PassEnd, runPass } from './answer-steps.ts';
import type { AnswerToolContext } from './answer-tools.ts';
import type {
  AnswerDependencies,
  AnswerMessage,
  AnswerOutcome,
  AnswerRequest,
  Answers,
  AskRequest,
  PreparedAnswer,
} from './answer-types.ts';
import { type ResponseWatch, watchedModel } from './answer-watch.ts';
import { languageModel, ModelUnavailableError } from './model.ts';
import { publicError } from './public-error.ts';

/**
 * The connectors a spec names: in its panels, its markers and its query-backed variables.
 *
 * @param spec - The spec.
 * @returns The names.
 */
function connectorNamesOf(spec: DashboardSpec): Set<string> {
  return new Set([
    ...spec.panels.flatMap((panel) => panel.queries.map((query) => query.connector)),
    ...spec.annotations.map((annotation) => annotation.query.connector),
    ...spec.variables.flatMap((variable) =>
      variable.kind === 'query' ? [variable.source.connector] : [],
    ),
  ]);
}

/**
 * Whether an access level lets the model read numbers: aggregates or full access.
 *
 * @param level - The access level.
 * @returns Whether it does.
 */
function readable(level: number): boolean {
  return level >= 3;
}

/**
 * The model of the answer job, or why there is none.
 *
 * @param dependencies - The service's dependencies.
 * @param providerId - The provider, if one is named.
 * @returns The settings and the model.
 * @throws {AppError} `bad_request` when the model cannot be built, such as without a key.
 */
async function answerModel(dependencies: AnswerDependencies, providerId?: string | null) {
  const resolved = await dependencies.modelSettings.resolve(providerId);
  try {
    return { resolved, model: (dependencies.buildModel ?? languageModel)(resolved, 'answer') };
  } catch (error) {
    if (error instanceof ModelUnavailableError) throw new AppError('bad_request', error.message);
    throw error;
  }
}

/**
 * The conversation of a question: earlier questions and answers, then this one.
 *
 * @param request - The question.
 * @returns The messages.
 */
function askMessages(request: AskRequest): ModelMessage[] {
  const earlier = (request.history ?? []).flatMap(({ question, answer }): ModelMessage[] => [
    { role: 'user', content: question },
    { role: 'assistant', content: answer },
  ]);
  return [...earlier, { role: 'user', content: request.question }];
}

/**
 * The instructions, messages and range of a request, and the variables it reads with.
 *
 * @param dependencies - The service's dependencies.
 * @param request - The request.
 * @param connectors - The dashboard's connectors that exist.
 * @returns What the request runs with.
 * @throws {AppError} `not_found` for an unknown panel, `bad_request` for a backward range.
 */
async function framing(
  dependencies: AnswerDependencies,
  request: AnswerRequest,
  connectors: readonly AnswerConnector[],
) {
  const { spec } = request;
  if (request.mode === 'explain') {
    const panel = spec.panels.find((candidate) => candidate.id === request.panelId);
    if (!panel) throw new AppError('not_found', `No panel "${request.panelId}" in this version.`);
    const content = `Explain the panel "${panel.title}".`;
    const instructions = explainInstructions(spec, panel, connectors);
    return { instructions, messages: [{ role: 'user', content }] as ModelMessage[], bindings: {} };
  }
  const { from, to } = request.time;
  if (!(from < to)) throw new AppError('bad_request', 'The time range ends before it starts.');
  const time = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  const choices = { variables: request.variables, time };
  const bindings = await dependencies.dashboards.bindVariables(spec, choices, request.signal);
  const facts = { ...request, connectors, range: request.time };
  const instructions = request.run
    ? runInstructions({ ...facts, run: request.run }, readable)
    : askInstructions(facts, readable);
  return { instructions, messages: askMessages(request), bindings };
}

/**
 * Prepares an answer: the model, the dashboard's connectors as the model may use them, the
 * instructions and the tools. Explain mode reads nothing.
 *
 * @param dependencies - The service's dependencies.
 * @param request - The request.
 * @returns The prepared answer.
 */
async function prepare(
  dependencies: AnswerDependencies,
  request: AnswerRequest,
): Promise<PreparedAnswer> {
  const watch: ResponseWatch = { latest: undefined };
  const { resolved, model } = await answerModel(dependencies, request.providerId);
  const names = connectorNamesOf(request.spec);
  const connectors = dependencies.modelView.connectors().filter(({ name }) => names.has(name));
  const { instructions, messages, bindings } = await framing(dependencies, request, connectors);
  const sink: PreparedAnswer['sink'] = {};
  const tools: AnswerToolContext = {
    ...toolScope(request, connectors),
    modelView: dependencies.modelView,
    bindings,
    watch,
    state: { evidence: [], given: undefined, failedAnswers: 0, followUps: [] },
    onEvidence: (data) => sink.writer?.write({ type: 'data-evidence', id: data.id, data }),
  };
  const watched = watchedModel(model, watch);
  const prepared = { request, resolved, model: watched, instructions, messages, tools, sink };
  return { ...prepared, usage: {}, tokens: 0 };
}

/**
 * What the tools of a request may reach: in `ask`, the readable connectors over the range asked
 * about; in `explain`, the schema as level 1 shows it and nothing else.
 *
 * @param request - The request.
 * @param connectors - The dashboard's connectors that exist.
 * @returns That part of the tools' context.
 */
function toolScope(request: AnswerRequest, connectors: readonly AnswerConnector[]) {
  const asking = request.mode === 'ask';
  return {
    spec: request.spec,
    connectors: connectors.map(({ name }) => name),
    readable: asking ? readableNames(connectors) : [],
    range: asking ? request.time : undefined,
    run: asking ? request.run : undefined,
    timeZone: asking ? request.timeZone : 'UTC',
    schemaOnly: !asking,
    signal: request.signal,
  };
}

/**
 * The connectors whose numbers the model may read.
 *
 * @param connectors - The dashboard's connectors.
 * @returns Their names.
 */
function readableNames(connectors: readonly AnswerConnector[]): string[] {
  return connectors.filter((each) => readable(each.accessLevel)).map(({ name }) => name);
}

/**
 * Why a finished run has no answer, in the words the person reads.
 *
 * @param prepared - The answer.
 * @param end - How the last pass ended.
 * @returns The ending, its message, and the provider's finish reason for a step with no call.
 */
function failureOf(prepared: PreparedAnswer, end: PassEnd) {
  const { failedAnswers } = prepared.tools.state;
  if (end.failure !== undefined) return { ending: 'error' as const, message: end.failure };
  const { stalled } = end;
  if (stalled && failedAnswers < answerTries) {
    const reason = stalled.finishReason ? { finishReason: stalled.finishReason } : {};
    return { ending: stalled.stall, message: stallMessage(stalled), ...reason };
  }
  return failedAnswers > 0
    ? { ending: 'refused' as const, message: refusedMessage }
    : { ending: 'limit' as const, message: limitMessage };
}

/** What the person reads when no answer passed its checks. */
const refusedMessage =
  'The answer did not hold up against its evidence, even after a repair. Try asking more narrowly.';

/** What the person reads when the tool call limit or the token budget ended the run. */
const limitMessage = 'No answer came within the limits of one answer. Try asking more narrowly.';

/**
 * The outcome of a finished run.
 *
 * @param prepared - The answer.
 * @param end - How the last pass ended.
 * @returns The outcome.
 */
function outcomeOf(prepared: PreparedAnswer, end: PassEnd): AnswerOutcome {
  const { state } = prepared.tools;
  const { usage } = prepared;
  const { evidence } = state;
  if (state.given && end.failure === undefined) {
    const { text, citations } = state.given;
    const answer = { mode: prepared.request.mode, text, citations: [...citations], evidence };
    const followUps = state.followUps.length > 0 ? { followUps: [...state.followUps] } : {};
    return { ok: true, answer: { ...answer, ...followUps }, usage };
  }
  const refused = end.failure === undefined && state.lastIssues;
  const issues = refused ? { issues: refused } : {};
  return { ok: false, ...failureOf(prepared, end), ...issues, evidence, usage };
}

/**
 * Whether a pass ended on a step with no tool call while the answer may still be given.
 *
 * @param prepared - The answer.
 * @param end - How the pass ended.
 * @returns `true` when a forced pass follows.
 */
function awaitsAnswer(prepared: PreparedAnswer, end: PassEnd): boolean {
  const { state } = prepared.tools;
  if (end.stalled === undefined || prepared.request.signal.aborted) return false;
  return state.given === undefined && state.failedAnswers < answerTries;
}

/**
 * The conversation a forced pass starts from: the question, then the calls and results of the
 * pass before it, without what its last step wrote instead of a call.
 *
 * @param prepared - The answer.
 * @param end - How the pass before ended.
 * @returns The messages.
 */
function messagesAfter(prepared: PreparedAnswer, end: PassEnd): ModelMessage[] {
  const said = [...end.said];
  while (said.at(-1)?.role === 'assistant') said.pop();
  return [...prepared.messages, ...said];
}

/**
 * Runs a prepared answer to its end. A pass that ends on a step with no tool call, with no answer
 * given, is followed by one pass that may only give the answer, from the evidence already read.
 *
 * @param dependencies - The service's dependencies.
 * @param prepared - The answer.
 * @param writer - Streams the model's parts, then the outcome and the finish, when given.
 * @returns The outcome; a failing model call is a failed outcome.
 */
async function run(
  dependencies: AnswerDependencies,
  prepared: PreparedAnswer,
  writer?: UIMessageStreamWriter<AnswerMessage>,
): Promise<AnswerOutcome> {
  if (writer) prepared.sink.writer = writer;
  const first = await runPass(dependencies, prepared, { ...prepared, forced: false, writer });
  const forced = { messages: messagesAfter(prepared, first), forced: true, writer };
  const end = awaitsAnswer(prepared, first) ? await runPass(dependencies, prepared, forced) : first;
  const outcome = outcomeOf(prepared, end);
  const data = outcome.ok
    ? { ok: true as const, answer: outcome.answer }
    : { ok: false as const, message: outcome.message };
  // The outcome is the last data part; the finish after it carries the usage.
  writer?.write({ type: 'data-outcome', data });
  writer?.write({ type: 'finish', messageMetadata: { usage: prepared.usage } });
  return outcome;
}

/**
 * Creates the answering service.
 *
 * @param dependencies - The gate, the dashboards, the usage ledger and the model settings.
 * @returns The service.
 */
export function createAnswers(dependencies: AnswerDependencies): Answers {
  return {
    async answer(request, writer) {
      return run(dependencies, await prepare(dependencies, request), writer);
    },
    async stream(request, onOutcome) {
      const prepared = await prepare(dependencies, request);
      const stream = createUIMessageStream<AnswerMessage>({
        execute: async ({ writer }) => {
          onOutcome(await run(dependencies, prepared, writer));
        },
        onError: publicError,
      });
      return createUIMessageStreamResponse({
        stream,
        consumeSseStream: ({ stream: sse }) => consumeStream({ stream: sse }),
      });
    },
  };
}
