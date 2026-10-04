/**
 * Questions about a pinned dashboard: a shared record of the dashboard, not a thread. Each one keeps
 * the version, the range and the variables as shown when it was asked, who asked, and the outcome:
 * the checked answer with its citations and evidence, or why there is none. Questions form
 * conversations: a first question and the questions that follow it, each about what was shown when
 * it was asked. Every role reads and searches them; analysts and above ask. The browser sends the
 * range and the variables as shown, never a query.
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
  /** Its conversation: the id of the conversation's first question, its own for a first one. */
  conversationId: z.string(),
  /** The range shown, resolved to epoch milliseconds when it was asked. */
  time: z.object({ from: z.number(), to: z.number() }),
  /** The range as chosen: relative, such as `now-1h`, or absolute. */
  chosenTime: timeRangeSchema,
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
  conversationId: true,
  version: true,
  askedBy: true,
  askedAt: true,
  question: true,
});

/** An earlier question that may already answer a new one. */
export type SimilarQuestion = z.infer<typeof similarQuestionSchema>;

/** Validates a conversation about a dashboard, as History lists it. */
export const conversationSchema = z.object({
  /** The id of its first question. */
  id: z.string(),
  /** Its first question. */
  question: z.string(),
  /** The name of the person who asked the first question. */
  startedBy: z.string(),
  startedAt: z.number(),
  /** How many questions it holds. */
  count: z.int(),
  /** When its latest question was asked. */
  lastAt: z.number(),
  /** In a search, its question that matches best; `null` outside a search. */
  match: z.object({ questionId: z.string(), question: z.string() }).nullable(),
  /** Whether the person asking may move it to the bin: its starter, or an admin. */
  canBin: z.boolean(),
});

/** A conversation about a dashboard. */
export type Conversation = z.infer<typeof conversationSchema>;

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
    /** The conversation this question continues: it follows up on its latest question. */
    conversationId: z.string().min(1).max(64).optional(),
    /** The question this one follows up on; leave it out with `conversationId`. */
    parentId: z.string().min(1).max(64).optional(),
  }),
  output: z.unknown(),
});

/** The header that names the question an answer stream stores. */
export const questionIdHeader = 'X-Question-Id';

/**
 * Lists a dashboard's conversations, the latest activity first. With `q`, only those one of whose
 * questions or answers shares a word with it, the best match first.
 */
export const listConversationsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/conversations',
  params: dashboardParams,
  query: z.object({ q: z.string().max(2000).default('') }),
  output: z.object({ conversations: z.array(conversationSchema) }),
});

/** Reads one conversation: its questions, in the order they were asked. */
export const getConversationEndpoint = defineEndpoint({
  method: 'GET',
  path: '/dashboards/:dashboardId/conversations/:conversationId',
  params: dashboardParams.extend({ conversationId: z.string().min(1).max(64) }),
  output: z.object({
    id: z.string(),
    questions: z.array(dashboardQuestionSchema),
    /** Whether the person asking may move it to the bin: its starter, or an admin. */
    canBin: z.boolean(),
  }),
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
