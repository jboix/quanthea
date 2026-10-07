/**
 * The endpoints of questions about a report's run. Every role reads and searches a run's
 * conversations and sees its sources' access levels; analysts and above ask, and move the
 * conversations they started to the bin. Asking streams the answer, which reads the run's frozen
 * results through the gate, and stores the question with its outcome, a failure too.
 */
import {
  askRunQuestionEndpoint,
  binRunConversationEndpoint,
  dashboardOfReport,
  getRunConversationEndpoint,
  listRunConversationsEndpoint,
  type Principal,
  questionIdHeader,
  runSourcesEndpoint,
  similarRunQuestionsEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Answers, AskRequest } from '../../agent/answer-types.ts';
import type { Users } from '../../auth/users.ts';
import type { ConversationBins } from '../../conversation-bins.ts';
import { mayBin } from '../../dashboards/conversation-bin.ts';
import type { ConversationInfo } from '../../dashboards/question-info.ts';
import type { RunQuestionInfo } from '../../reports/question-info.ts';
import type { PreparedRunQuestion, RunQuestions } from '../../reports/questions.ts';
import type { ThreadBin } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint, mountStreamEndpoint } from '../endpoint.ts';
import { ownerNames, readerRole } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the run question endpoints need. */
export interface RunQuestionRouteServices {
  /** The questions about runs. */
  readonly runQuestions: RunQuestions;
  /** The answering service. */
  readonly answers: Pick<Answers, 'stream'>;
  /** The bins of conversations. */
  readonly conversationBin: Pick<ConversationBins, 'binRun'>;
  /** The users, for the askers' names. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The bin, for the owner of a report's thread: a draft's runs follow it. */
  readonly bin: Pick<ThreadBin, 'threadOwner'>;
}

/**
 * The role someone reads a report's runs with: the runs of a draft follow the report's thread.
 *
 * @param bin - The bin, for the owner of a thread.
 * @param principal - Who reads.
 * @returns The role for what each thread made.
 */
function readerOf(bin: RunQuestionRouteServices['bin'], principal: Principal | null) {
  return readerRole(signedIn(principal), bin.threadOwner);
}

/**
 * Names the askers of questions, looking each up once per request.
 *
 * @param users - The users.
 * @returns A function that replaces a question's asker id with their name.
 */
function namer(users: Pick<Users, 'nameOf'>) {
  const nameOf = ownerNames(users);
  return async ({ askerId, ...info }: RunQuestionInfo) => ({
    ...info,
    askedBy: await nameOf(askerId),
  });
}

/**
 * Names the people who started conversations, and says whether the principal may bin each.
 *
 * @param users - The users.
 * @param principal - Who asks.
 * @returns A function that replaces a conversation's starter id with their name.
 */
function starterNamer(users: Pick<Users, 'nameOf'>, principal: Principal) {
  const nameOf = ownerNames(users);
  return async ({ starterId, ...info }: ConversationInfo) => ({
    ...info,
    startedBy: await nameOf(starterId),
    canBin: mayBin(principal, starterId),
  });
}

/**
 * The answering service's request for a prepared question: the report's panels over the run's
 * period, and the run's frozen results.
 *
 * @param prepared - The question.
 * @param signal - Aborted when the person leaves.
 * @returns The request.
 */
function askRequestOf(prepared: PreparedRunQuestion, signal: AbortSignal): AskRequest {
  const { run, question, history, timeZone } = prepared;
  const frozen = {
    label: run.period.label,
    comparison: run.comparison,
    panels: run.panels ?? {},
    comparisonPanels: run.comparisonPanels,
  };
  return {
    mode: 'ask',
    dashboardId: null,
    spec: dashboardOfReport(run.spec, run.period),
    time: { from: run.period.from, to: run.period.to },
    ...{ timeZone, variables: run.variables, question, history },
    run: frozen,
    actor: prepared.askedBy,
    signal,
  };
}

/**
 * Mounts the endpoint that asks: it streams the answer, then stores the question with its
 * outcome, unless the person left before the end.
 *
 * @param app - The app.
 * @param services - The questions and the answering service.
 */
function mountAskEndpoint(app: Hono<AppEnv>, services: RunQuestionRouteServices): void {
  const { runQuestions, answers } = services;
  mountStreamEndpoint(app, askRunQuestionEndpoint, {
    access: 'analyst',
    handle: async ({ params, body, principal, signal }) => {
      const request = { ...params, ...body };
      const reader = readerOf(services.bin, principal);
      const prepared = runQuestions.prepare(request, actorOf(principal), reader);
      const response = await answers.stream(askRequestOf(prepared, signal), (outcome) => {
        if (!signal.aborted) runQuestions.record(prepared, outcome);
      });
      response.headers.set(questionIdHeader, prepared.id);
      return response;
    },
  });
}

/**
 * Mounts the endpoints that list, search, read and bin conversations.
 *
 * @param app - The app.
 * @param services - The questions, the bin and the users.
 */
function mountConversationEndpoints(app: Hono<AppEnv>, services: RunQuestionRouteServices): void {
  const { runQuestions, users, bin } = services;
  mountEndpoint(app, listRunConversationsEndpoint, {
    access: 'viewer',
    handle: async ({ params, query, principal }) => {
      const reader = signedIn(principal);
      const listed = runQuestions.conversations(params, query.q, readerOf(bin, reader));
      return { conversations: await Promise.all(listed.map(starterNamer(users, reader))) };
    },
  });
  mountEndpoint(app, getRunConversationEndpoint, {
    access: 'viewer',
    handle: async ({ params, principal }) => {
      const reader = signedIn(principal);
      const role = readerOf(bin, reader);
      const asked = runQuestions.conversation(params, params.conversationId, role);
      const starterId = asked.find((each) => each.id === params.conversationId)?.askerId ?? '';
      return {
        id: params.conversationId,
        questions: await Promise.all(asked.map(namer(users))),
        canBin: mayBin(reader, starterId),
      };
    },
  });
  mountEndpoint(app, binRunConversationEndpoint, {
    access: 'analyst',
    handle: ({ params, principal }) => {
      const actor = signedIn(principal);
      services.conversationBin.binRun(params, actor, readerOf(bin, actor));
      return { binned: true as const };
    },
  });
}

/**
 * Mounts every endpoint of questions about runs.
 *
 * @param app - The app.
 * @param services - The questions, the answering service, the bin and the users.
 */
export function mountRunQuestionEndpoints(
  app: Hono<AppEnv>,
  services: RunQuestionRouteServices,
): void {
  const { runQuestions, users, bin } = services;
  mountAskEndpoint(app, services);
  mountConversationEndpoints(app, services);
  mountEndpoint(app, similarRunQuestionsEndpoint, {
    access: 'viewer',
    handle: async ({ params, query, principal }) => {
      const found = runQuestions.similar(params, query.q, readerOf(bin, principal));
      return { questions: await Promise.all(found.map(namer(users))) };
    },
  });
  mountEndpoint(app, runSourcesEndpoint, {
    access: 'viewer',
    handle: ({ params, principal }) => ({
      sources: runQuestions.sources(params, readerOf(bin, principal)),
    }),
  });
}
