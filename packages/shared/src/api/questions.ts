/**
 * Questions about a pinned dashboard: a shared record of the dashboard, not a thread. Each one keeps
 * the version, the range and the variables as shown when it was asked, who asked, and the outcome:
 * the checked answer with its citations and evidence, or why there is none. Every role reads them;
 * analysts and above ask. The browser sends the range and the variables as shown, never a query.
 */
import { z } from 'zod';
import { answerEvidenceSchema, answerSchema } from '../answers.ts';
import { accessLevelSchema } from '../connectors.ts';
import { timeRangeSchema } from '../spec/time.ts';
import { variableValuesSchema } from '../spec/variables.ts';
import { defineEndpoint } from './contract.ts';

/** Validates how a question ended: the checked answer, or why there is none and what was read. */
export const questionOutcomeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), answer: answerSchema }),
  z.object({ ok: z.literal(false), message: z.string(), evidence: z.array(answerEvidenceSchema) }),
]);

/** How a question ended. */
export type QuestionOutcome = z.infer<typeof questionOutcomeSchema>;

/** Validates a stored question with its outcome. */
export const dashboardQuestionSchema = z.object({
  id: z.string(),
  dashboardId: z.string(),
  /** The version shown when it was asked. */
  version: z.int(),
  /** The question it follows up on, or `null`. */
  parentId: z.string().nullable(),
  /** The range shown, resolved to epoch milliseconds when it was asked. */
  time: z.object({ from: z.number(), to: z.number() }),
  /** The time zone the answer names times in. */
  timeZone: z.string(),
  /** The variable values shown: the chosen ones, else the defaults. */
  variables: variableValuesSchema,
  /** The sets of markers hidden when it was asked. */
  hiddenMarkers: z.array(z.string()),
  /** No source of the dashboard showed numbers: the answer could only explain. */
  explainOnly: z.boolean(),
  /** The name of the person who asked, for accountability: it gives them no rights over it. */
  askedBy: z.string(),
  askedAt: z.number(),
  question: z.string(),
  outcome: questionOutcomeSchema,
  /** The tokens the answer spent, all models together. */
  tokens: z.int(),
});

/** A stored question with its outcome. */
export type DashboardQuestion = z.infer<typeof dashboardQuestionSchema>;

/** Validates an earlier question that may already answer a new one. */
export const similarQuestionSchema = dashboardQuestionSchema.pick({
  id: true,
  version: true,
  askedBy: true,
  askedAt: true,
  question: true,
});

/** An earlier question that may already answer a new one. */
export type SimilarQuestion = z.infer<typeof similarQuestionSchema>;

/** Validates a source of a dashboard as everyone may see it: its name and its access level. */
export const dashboardSourceSchema = z.object({
  name: z.string(),
  /** Its access level, or `null` when no connector has that name any more. */
  accessLevel: accessLevelSchema.nullable(),
});

/** A source of a dashboard, by name and access level. */
export type DashboardSource = z.infer<typeof dashboardSourceSchema>;

/** The path parameter of a dashboard. */
const dashboardParams = z.object({ dashboardId: z.string().min(1) });

/**
 * Asks a question about a pinned version, as the dashboard shows it. The server resolves the range
 * to absolute times and binds the variables as a panel run does. It answers with an AI SDK UI
 * message stream, not JSON: the answer's text as it is written, a `data-evidence` part per read,
 * then a `data-outcome` part. The question is stored with its outcome; the `X-Question-Id` header
 * names it.
 */
export const askQuestionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/dashboards/:dashboardId/questions',
  params: dashboardParams,
  body: z.object({
    version: z.int().min(1),
    question: z.string().trim().min(1).max(2000),
    variables: variableValuesSchema.default({}),
    /** The time range as shown; the spec's default when omitted. */
    time: timeRangeSchema.optional(),
    hiddenMarkers: z.array(z.string().max(64)).max(20).default([]),
    /** The browser's time zone, for a dashboard that names none. */
    timeZone: z.string().min(1).max(64),
    /** The question this one follows up on. */
    parentId: z.string().min(1).max(64).optional(),
  }),
  output: z.unknown(),
});

/** The header that names the question an answer stream stores. */
export const questionIdHeader = 'X-Question-Id';

/** Lists a dashboard's questions, the newest first. */
export const listQuestionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/questions',
  params: dashboardParams,
  output: z.object({ questions: z.array(dashboardQuestionSchema) }),
});

/** Reads one question of a dashboard. */
export const getQuestionEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/questions/:questionId',
  params: dashboardParams.extend({ questionId: z.string().min(1).max(64) }),
  output: dashboardQuestionSchema,
});

/** Finds earlier answered questions of a dashboard whose question or answer shares the words. */
export const similarQuestionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/similar-questions',
  params: dashboardParams,
  query: z.object({ q: z.string().max(2000).default('') }),
  output: z.object({ questions: z.array(similarQuestionSchema) }),
});

/** The sources a version reads, by name and access level only, so the Ask tab tells the truth. */
export const dashboardSourcesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/versions/:version/sources',
  params: dashboardParams.extend({ version: z.string().regex(/^[1-9]\d{0,5}$/) }),
  output: z.object({ sources: z.array(dashboardSourceSchema) }),
});
