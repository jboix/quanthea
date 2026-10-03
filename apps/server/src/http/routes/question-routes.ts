/**
 * The endpoints of questions about a pinned dashboard. Every role reads a dashboard's questions,
 * searches them and sees its sources' access levels; analysts and above ask. Asking streams the
 * answer and stores the question with its outcome, a failure too. The asker is named for
 * accountability only: no one owns a question.
 */
import {
  askQuestionEndpoint,
  dashboardSourcesEndpoint,
  getQuestionEndpoint,
  listQuestionsEndpoint,
  type Principal,
  questionIdHeader,
  similarQuestionsEndpoint,
} from '@quanthea/shared';
import type { Hono } from 'hono';
import type { Answers, AskRequest } from '../../agent/answer-types.ts';
import type { Users } from '../../auth/users.ts';
import type { PreparedQuestion, QuestionInfo, Questions } from '../../dashboards/questions.ts';
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
  mountEndpoint(app, listQuestionsEndpoint, {
    access: 'viewer',
    handle: async ({ params: { dashboardId }, principal }) => {
      const listed = questions.list(dashboardId, roleFor(principal, dashboardId));
      return { questions: await Promise.all(listed.map(namer(users))) };
    },
  });
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
