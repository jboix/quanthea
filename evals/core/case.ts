/**
 * The shape of every eval case: given, input, checks, rubric. A fixture arranges the world, one
 * input acts on a surface of the product, code checks facts about what came of it, and a judge
 * reads the rubric for what only reading can tell. No case starts from what another case made.
 */
import type { AccessLevel, TimeRangeExpression } from '@quanthea/shared';
import type { AlertCaseOutcome } from '../checks/alert.ts';
import type { AnswerCaseOutcome } from '../checks/answer.ts';
import type { Outcome } from '../checks/dashboard.ts';
import type { ReportCaseOutcome } from '../checks/report.ts';
import type { RunAnswerCaseOutcome } from '../checks/run-answer.ts';
import type { EvalWorld } from '../world/setup.ts';

/**
 * Why a case exists. A capability case asks exactly, and has one right outcome: a failure is the
 * product's. A realistic case asks as a person would, and takes any reasonable answer. Each bucket
 * has its own headline number.
 */
export type Bucket = 'capability' | 'realistic';

/**
 * How a check decides. Structure: the thing was made and runs. Result: its numbers are the ones
 * computed from the data. Feature: it has the feature the case is about. Legacy: a pattern over a
 * title, a query or a text, kept from the scoring before rubrics and results.
 */
export type CheckKind = 'structure' | 'result' | 'feature' | 'legacy';

/** A value computed from the dev data on a path of its own, for result checks to compare with. */
export interface Truth<Value = unknown> {
  /** Its name, under which a trial keeps it. */
  readonly key: string;
  /**
   * Computes it.
   *
   * @param now - The run's clock, in epoch milliseconds.
   * @param evidence - What the case made, for a truth about what it names, such as a run's period.
   * @returns The value.
   */
  readonly compute: (now: number, evidence: unknown) => Promise<Value>;
}

/** What a check may read beside the evidence. */
export interface CheckContext {
  /** The truths the case's checks asked for, by key, as computed when the trial ran. */
  readonly truth: Readonly<Record<string, unknown>>;
}

/** One assertion about what a case made, decided by code. */
export interface Check<Evidence> {
  /** Its name, such as `built` or `panel-count`. */
  readonly id: string;
  /** How it decides. */
  readonly kind: CheckKind;
  /** Whether the checks after it and the judge need it: when it fails, they are skipped. */
  readonly gate?: boolean;
  /** The truths it compares with. */
  readonly truths?: readonly Truth[];
  /**
   * For a legacy check: what it stands in for. It counts only while the trial has no judged
   * rubric, or no result check that ran.
   */
  readonly standsInFor?: 'rubric' | 'result';
  /** Whether the scoring before rubrics and results did not have it. */
  readonly added?: boolean;
  /** For a check of a pattern: the pattern, which the layout mark reads as what the case asks for. */
  readonly pattern?: RegExp;
  /**
   * What does not hold.
   *
   * @param evidence - What the case made.
   * @param context - The truths.
   * @returns The faults, each a sentence; none when the check passes.
   */
  readonly faults: (evidence: Evidence, context: CheckContext) => readonly string[];
}

/** Something the world must have before a case can run. */
export type Need = 'search' | 'http' | 'pinned-target';

/** What a fixture left in the world for the input to act on. */
export interface Given {
  /** A pinned dashboard to ask about, or to start an alert from. */
  readonly dashboardId?: string;
  /** A thread to continue. */
  readonly threadId?: string;
  /** A stored question to follow up on. */
  readonly parentQuestionId?: string;
  /** A report's run to ask about. */
  readonly run?: { readonly reportId: string; readonly runId: string };
}

/** The state of the world before a case acts, built by the app's own services. */
export interface Fixture {
  /** Its name, such as `alert-thread:checkout-share`. */
  readonly id: string;
  /** What the world must have for it. */
  readonly needs?: readonly Need[];
  /**
   * Builds the state in a world no other case has touched.
   *
   * @param world - The world.
   * @returns What it left there.
   */
  readonly prepare: (world: EvalWorld) => Promise<Given>;
}

/** What a person says in a thread. */
export interface ThreadInput {
  /** The person's messages, in order. Each is talked through to its end: one, three at most. */
  readonly turns: readonly string[];
  /** How the person answers a question of the agent; its first option when left out. */
  readonly reply?: string;
  /** The person's time zone; Zurich when left out. */
  readonly timeZone?: string;
  /** The access level every connector has while the case runs; the connectors' own when left out. */
  readonly accessLevel?: AccessLevel;
}

/** A question about a pinned dashboard. */
export interface AnswerInput {
  /** The question. */
  readonly turns: readonly [string];
  /** The range the person looks at, relative to the run's clock. */
  readonly time: TimeRangeExpression;
  /** The person's time zone; Zurich when left out. */
  readonly timeZone?: string;
  /** The access level every connector has while the case runs. */
  readonly accessLevel: AccessLevel;
}

/** A request for a panel's explanation. */
export interface ExplanationInput {
  /** Nothing is said: the person opens the explanation. */
  readonly turns: readonly [];
  /** The panel of the pinned dashboard. */
  readonly panel: string;
  /** The access level every connector has while the case runs. */
  readonly accessLevel: AccessLevel;
}

/** Questions about a report's run, each following up on the one before. */
export interface RunAnswerInput {
  /** The questions, in order. */
  readonly turns: readonly string[];
  /** The access level every connector has while the case runs. */
  readonly accessLevel: AccessLevel;
}

/** Each surface of the product a case can act on: what it takes, and what comes of it. */
export interface Surfaces {
  /** A thread that builds a dashboard. */
  readonly dashboard: { readonly input: ThreadInput; readonly evidence: Outcome };
  /** A thread that writes an alert. */
  readonly alert: { readonly input: ThreadInput; readonly evidence: AlertCaseOutcome };
  /** A thread that writes a report. */
  readonly report: { readonly input: ThreadInput; readonly evidence: ReportCaseOutcome };
  /** The Ask tab of a pinned dashboard. */
  readonly answer: { readonly input: AnswerInput; readonly evidence: AnswerCaseOutcome };
  /** A panel's explanation. */
  readonly explanation: { readonly input: ExplanationInput; readonly evidence: AnswerCaseOutcome };
  /** The questions about a report's run. */
  readonly 'run-answer': {
    readonly input: RunAnswerInput;
    readonly evidence: RunAnswerCaseOutcome;
  };
}

/** The name of a surface. */
export type SurfaceName = keyof Surfaces;

/** What a surface's cases make. */
export type EvidenceOf<Surface extends SurfaceName> = Surfaces[Surface]['evidence'];

/** A case on one surface. */
export interface CaseOn<Surface extends SurfaceName> {
  /** Its id, for `--only`. */
  readonly id: string;
  /** Why it exists. */
  readonly bucket: Bucket;
  /** Arrange: the world before the case acts. */
  readonly given: Fixture;
  /** Act: the surface, and what the person does there. */
  readonly input: { readonly surface: Surface } & Surfaces[Surface]['input'];
  /**
   * Assert, by code: what is specific to the case, in the order one needs the other. The
   * surface's own structure checks run before them.
   */
  readonly checks: readonly Check<EvidenceOf<Surface>>[];
  /** The ids of the surface's own checks this case leaves out. */
  readonly without?: readonly string[];
  /** Assert, by the judge: plain sentences, one claim each, answered yes or no. */
  readonly rubric?: readonly string[];
  /** The family of panels it covers, for the cases that have one. */
  readonly family?: string;
}

/** A case on any surface. */
export type EvalCase = { readonly [Surface in SurfaceName]: CaseOn<Surface> }[SurfaceName];

/** What any case made. */
export type Evidence = EvidenceOf<SurfaceName>;

/**
 * What a case asks, in one line, for a report.
 *
 * @param evalCase - The case.
 * @returns Its turns joined, or the panel it explains.
 */
export function askOf(evalCase: EvalCase): string {
  if (evalCase.input.surface === 'explanation') return `Explain the panel ${evalCase.input.panel}.`;
  return evalCase.input.turns.join(' Then: ');
}
