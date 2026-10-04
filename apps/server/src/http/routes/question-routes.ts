/**
 * The endpoints of questions about a pinned dashboard. Every role reads and searches a dashboard's
 * conversations and questions and sees its sources' access levels; analysts and above ask. Asking streams the
 * answer and stores the question with its outcome, a failure too. The asker is named for
 * accountability only: no one owns a question.
 */
import {
  askQuestionEndpoint,
  dashboardSourcesEndpoint,
  getConversationEndpoint,
  getQuestionEndpoint,
  listConversationsEndpoint,
  type Principal,
  questionIdHeader,
  type Role,
  similarQuestionsEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Answers, AskRequest } from '../../agent/answer-types.ts';
import type { Users } from '../../auth/users.ts';
import { mayBin } from '../../dashboards/conversation-bin.ts';
import type { ConversationInfo, QuestionInfo } from '../../dashboards/question-info.ts';
import type { PreparedQuestion, Questions } from '../../dashboards/questions.ts';
import type { ThreadOwner } from '../../threads/bin.ts';
import type { AppEnv } from '../app-env.ts';
import { mountEndpoint, mountStreamEndpoint } from '../endpoint.ts';
import { ownerNames, roleForDashboard } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** What the question endpoints need. */
export interface QuestionRouteServices {
  /** The questions. */
  readonly questions: Questions;
  /** The answering service. */
  readonly answers: Pick<Answers, 'stream'>;
  /** The users, for the askers' names. */
  readonly users: Pick<Users, 'nameOf'>;
  /** The thread a dashboard belongs to, in the bin or not. */
  readonly ownerOf: (dashboardId: string) => ThreadOwner | null;
}

/**
 * Names the askers of questions, looking each up once per request.
 *
 * @param users - The users.
 * @returns A function that replaces a question's asker id with their name.
 */
function namer(users: Pick<Users, 'nameOf'>) {
  const nameOf = ownerNames(users);
  return async ({ askerId, ...info }: QuestionInfo) => ({
    ...info,
    askedBy: await nameOf(askerId),
  });
}

/**
 * Names the people who started conversations, looking each up once per request, and says whether
 * the principal may move each to the bin.
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
 * Mounts the endpoints that list, search and read conversations.
 *
 * @param app - The app.
 * @param services - The questions and the users.
 * @param roleFor - The role a principal reads a dashboard with.
 */
function mountConversationEndpoints(
  app: Hono<AppEnv>,
  services: QuestionRouteServices,
  roleFor: (principal: Principal | null, dashboardId: string) => Role,
): void {
  const { questions, users } = services;
  mountEndpoint(app, listConversationsEndpoint, {
    access: 'viewer',
    handle: async ({ params: { dashboardId }, query, principal }) => {
      const role = roleFor(principal, dashboardId);
      const listed = questions.conversations(dashboardId, query.q, role);
      const named = starterNamer(users, signedIn(principal));
      return { conversations: await Promise.all(listed.map(named)) };
    },
  });
  mountEndpoint(app, getConversationEndpoint, {
    access: 'viewer',
    handle: async ({ params: { dashboardId, conversationId }, principal }) => {
      const role = roleFor(principal, dashboardId);
      const asked = questions.conversation(dashboardId, conversationId, role);
      const starterId = asked.find((each) => each.id === conversationId)?.askerId ?? '';
      return {
        id: conversationId,
        questions: await Promise.all(asked.map(namer(users))),
        canBin: mayBin(signedIn(principal), starterId),
      };
    },
  });
}

/**
 * The answering service's request for a prepared question.
 *
 * @param prepared - The question.
 * @param signal - Aborted when the person leaves.
 * @returns The request.
 */
function askRequestOf(prepared: PreparedQuestion, signal: AbortSignal): AskRequest {
  const { dashboardId, spec, time, timeZone, variables, question, history } = prepared;
  const asked = { dashboardId, spec, time, timeZone, variables, question, history };
  return { ...asked, mode: 'ask', actor: prepared.askedBy, signal };
}

/**
 * Mounts the endpoint that asks: it streams the answer, then stores the question with its
 * outcome, unless the person left before the end.
 *
 * @param app - The app.
 * @param services - The questions and the answering service.
 */
function mountAskEndpoint(app: Hono<AppEnv>, services: QuestionRouteServices): void {
  const { questions, answers } = services;
  mountStreamEndpoint(app, askQuestionEndpoint, {
    access: 'analyst',
    handle: async ({ params, body, principal, signal }) => {
      const request = { ...body, dashboardId: params.dashboardId };
      const prepared = questions.prepare(request, actorOf(principal));
      const response = await answers.stream(askRequestOf(prepared, signal), (outcome) => {
        if (!signal.aborted) questions.record(prepared, outcome);
      });
      response.headers.set(questionIdHeader, prepared.id);
      return response;
    },
  });
}

/**
 * Mounts every question endpoint.
 *
 * @param app - The app.
 * @param services - The questions, the answering service, the users and the owner of a dashboard.
 */
export function mountQuestionEndpoints(app: Hono<AppEnv>, services: QuestionRouteServices): void {
  const { questions, users } = services;
  const roleFor = (principal: Principal | null, dashboardId: string) =>
    roleForDashboard(signedIn(principal), services.ownerOf(dashboardId));
  mountAskEndpoint(app, services);
  mountConversationEndpoints(app, services, roleFor);
  mountEndpoint(app, getQuestionEndpoint, {
    access: 'viewer',
    handle: ({ params: { dashboardId, questionId }, principal }) =>
      namer(users)(questions.get(dashboardId, questionId, roleFor(principal, dashboardId))),
  });
  mountEndpoint(app, similarQuestionsEndpoint, {
    access: 'viewer',
    handle: async ({ params: { dashboardId }, query, principal }) => {
      const found = questions.similar(dashboardId, query.q, roleFor(principal, dashboardId));
      return { questions: await Promise.all(found.map(namer(users))) };
    },
  });
  mountEndpoint(app, dashboardSourcesEndpoint, {
    access: 'viewer',
    handle: ({ params: { dashboardId, version }, principal }) => {
      const target = { dashboardId, version: Number(version) };
      return { sources: questions.sources(target, roleFor(principal, dashboardId)) };
    },
  });
}
