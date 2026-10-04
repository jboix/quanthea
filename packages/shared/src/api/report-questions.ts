/**
 * Questions about a report's run: a shared record of the run, as questions about a pinned dashboard
 * are of the dashboard. The answer reads the run's frozen results as the access levels allow, and
 * may query the sources at Aggregates or Full access. Questions form conversations on one run.
 * Every role reads and searches them; analysts and above ask. The browser sends the question, never
 * a query or a result.
 */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';
import { conversationSchema, dashboardSourceSchema, questionOutcomeSchema } from './questions.ts';

/** Validates a stored question about a run, with its outcome. */
export const runQuestionSchema = z.object({
  id: z.string(),
  reportId: z.string(),
  runId: z.string(),
  /** The question it follows up on, or `null`. */
  parentId: z.string().nullable(),
  /** Its conversation: the id of the conversation's first question, its own for a first one. */
  conversationId: z.string(),
  /** The time zone the answer names times in: the report's schedule's. */
  timeZone: z.string(),
  /** No source of the run showed numbers: the answer saw shapes only. */
  explainOnly: z.boolean(),
  /** The name of the person who asked, for accountability: it gives them no rights over it. */
  askedBy: z.string(),
  askedAt: z.number(),
  question: z.string(),
  /** The answer, with what it proposed to watch, or why there is none. */
  outcome: questionOutcomeSchema,
  /** The tokens the answer spent, all models together. */
  tokens: z.int(),
});

/** A stored question about a run. */
export type RunQuestion = z.infer<typeof runQuestionSchema>;

/** Validates an earlier question about the run that may already answer a new one. */
export const similarRunQuestionSchema = runQuestionSchema.pick({
  id: true,
  conversationId: true,
  askedBy: true,
  askedAt: true,
  question: true,
});

/** An earlier question about the run. */
export type SimilarRunQuestion = z.infer<typeof similarRunQuestionSchema>;

/** The path parameters of a run. */
const runParams = z.object({
  reportId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
});

/** The path parameters of a conversation about a run. */
const conversationParams = runParams.extend({ conversationId: z.string().min(1).max(64) });

/**
 * Asks a question about a run. The answer reads the run's frozen results through the access levels
 * and may query the sources at Aggregates or Full access over the run's period. It answers with an
 * AI SDK UI message stream, as a question about a dashboard does; the `X-Question-Id` header names
 * the stored question.
 */
export const askRunQuestionEndpoint = defineEndpoint({
  method: 'POST',
  path: '/reports/:reportId/runs/:runId/questions',
  params: runParams,
  body: z.object({
    question: z.string().trim().min(1).max(2000),
    /** The conversation this question continues: it follows up on its latest question. */
    conversationId: z.string().min(1).max(64).optional(),
  }),
  output: z.unknown(),
});

/**
 * Lists a run's conversations, the latest activity first. With `q`, only those whose questions and
 * answers hold every word, the best match first.
 */
export const listRunConversationsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/reports/:reportId/runs/:runId/conversations',
  params: runParams,
  query: z.object({ q: z.string().max(2000).default('') }),
  output: z.object({ conversations: z.array(conversationSchema) }),
});

/** Reads one conversation about a run: its questions, in the order they were asked. */
export const getRunConversationEndpoint = defineEndpoint({
  method: 'GET',
  path: '/reports/:reportId/runs/:runId/conversations/:conversationId',
  params: conversationParams,
  output: z.object({
    id: z.string(),
    questions: z.array(runQuestionSchema),
    /** Whether the person asking may move it to the bin: its starter, or an admin. */
    canBin: z.boolean(),
  }),
});

/** Moves a conversation about a run to the bin. */
export const binRunConversationEndpoint = defineEndpoint({
  method: 'DELETE',
  path: '/reports/:reportId/runs/:runId/conversations/:conversationId',
  params: conversationParams,
  output: z.object({ binned: z.literal(true) }),
});

/** Finds earlier answered questions about a run whose question or answer shares the words. */
export const similarRunQuestionsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/reports/:reportId/runs/:runId/similar-questions',
  params: runParams,
  query: z.object({ q: z.string().max(2000).default('') }),
  output: z.object({ questions: z.array(similarRunQuestionSchema) }),
});

/** The sources a run's version reads, by name and access level only. */
export const runSourcesEndpoint = defineEndpoint({
  method: 'GET',
  path: '/reports/:reportId/runs/:runId/sources',
  params: runParams,
  output: z.object({ sources: z.array(dashboardSourceSchema) }),
});
