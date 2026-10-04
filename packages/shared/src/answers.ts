/**
 * Answers about a dashboard: a short text with numbered markers, the citations the markers point
 * at, and the evidence the server recorded from each read of data. Shared by the server, which
 * checks and streams them, and the browser, which draws them beside the charts.
 */
import { z } from 'zod';

/** What a marker such as `[2]` in an answer points at. */
export const answerCitationSchema = z.strictObject({
  /** The marker's number. */
  n: z.int().min(1).max(50).describe('The number in the marker, such as 2 for [2].'),
  /** The read that shows it, by id. */
  evidenceId: z.string().max(20).optional().describe('The read that shows it: its evidenceId.'),
  /** The panel it is about. */
  panelId: z.string().max(100).optional().describe('The panel it is about: its id.'),
  /** The start of the time window to shade, ISO 8601 with an offset. */
  from: z.string().max(40).optional().describe('Start of the time window to shade, ISO 8601.'),
  /** The end of the time window to shade, ISO 8601 with an offset. */
  to: z.string().max(40).optional().describe('End of the time window to shade, ISO 8601.'),
});

/** A citation. */
export type AnswerCitation = z.infer<typeof answerCitationSchema>;

/** What a follow-up card would start: an alert conversation, or a dashboard conversation. */
export const followUpKinds = ['alert', 'dashboard'] as const;

/** The most follow-up cards one answer carries. */
export const maxFollowUps = 3;

/**
 * Something worth watching that an answer about a report's run proposes: an alert or a dashboard,
 * and the first message of the conversation that would make it. The model writes the words; they
 * are shown as plain text, and a person starts the conversation, never the model.
 */
export const followUpSchema = z.strictObject({
  /** What the conversation would make. */
  kind: z.enum(followUpKinds).describe('alert: something to be told about; dashboard: to look at.'),
  /** A few words naming it, on one line. */
  title: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\r\n]*$/, 'One line.')
    .describe('A few plain words naming it, on one line.'),
  /** The first message of the conversation it would start. */
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(600)
    .describe(
      'The first message of the conversation it would start, in plain words: what to watch or show, the source, and the threshold or window.',
    ),
});

/** A follow-up card. */
export type FollowUp = z.infer<typeof followUpSchema>;

/** One read of data the model made, recorded by the server: what ran and what the gate let out. */
export const answerEvidenceSchema = z.object({
  /** Its id, such as `e1`, which citations name. */
  id: z.string(),
  /** The connector the query ran on. */
  connector: z.string(),
  /** The panel whose query ran, when the model read a panel. */
  panelId: z.string().optional(),
  /** The query as it ran: the template, before the variables were bound. */
  query: z.record(z.string(), z.unknown()),
  /** The variable values it was bound with. */
  variables: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  /** The time range it ran over, ISO 8601. */
  time: z.object({ from: z.string(), to: z.string() }),
  /** What the model received: the result as the connector's access level allows. */
  result: z.unknown(),
  /** Whether it read a report run's frozen results, which ran no query. */
  frozen: z.boolean().optional(),
});

/** A recorded read. */
export type AnswerEvidence = z.infer<typeof answerEvidenceSchema>;

/** A checked answer. */
export const answerSchema = z.object({
  /** `ask`: a question about the data; `explain`: what a panel measures, with no data. */
  mode: z.enum(['ask', 'explain']),
  /** A few plain sentences with markers such as `[1]`. */
  text: z.string(),
  /** One citation per marker. */
  citations: z.array(answerCitationSchema),
  /** Every read the model made while answering. */
  evidence: z.array(answerEvidenceSchema),
  /** What is worth watching next, for an answer about a report's run. */
  followUps: z.array(followUpSchema).max(maxFollowUps).optional(),
});

/** An answer. */
export type Answer = z.infer<typeof answerSchema>;

/** The custom parts of an answer's stream. */
export const answerDataSchemas = {
  /** A read of data, as soon as it is made. */
  evidence: answerEvidenceSchema,
  /** The end: the checked answer, or why there is none. */
  outcome: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), answer: answerSchema }),
    z.object({ ok: z.literal(false), message: z.string() }),
  ]),
};

/** The data of each custom part of an answer's stream. */
export type AnswerData = {
  [Name in keyof typeof answerDataSchemas]: z.infer<(typeof answerDataSchemas)[Name]>;
};
