/**
 * The alert evaluator: an in-process job that ticks every few seconds and evaluates each active
 * alert once its interval has passed since its last evaluation. After downtime an alert is
 * evaluated once, not once per missed interval. Evaluations run within a cap per connector and a
 * cap in all, and one failing alert never stops the others.
 */
import { durationMs } from '@quanthea/shared';
import type { Alerts } from '../alerts/alerts.ts';
import {
  type EvaluatedAlert,
  type EvaluationDependencies,
  evaluateAlert,
} from '../alerts/evaluate.ts';
import { createLimiter, type LimiterCaps } from '../alerts/limiter.ts';
import type { Logger } from '../lib/logger.ts';

/** What the evaluator needs. */
export interface AlertEvaluatorDependencies {
  /** The alerts to evaluate. */
  readonly alerts: Pick<Alerts, 'evaluated'>;
  /** What evaluating one alert needs, but the logger. */
  readonly evaluation: Omit<EvaluationDependencies, 'logger'>;
  /** Reports failures. */
  readonly logger: Logger;
  /** Evaluates one alert; {@link evaluateAlert} by default. */
  readonly evaluate?: typeof evaluateAlert;
  /** The caps on evaluations running at once. */
  readonly caps?: LimiterCaps;
  /** The clock; `Date.now` by default. */
  readonly now?: () => number;
}

/** The evaluator. */
export interface AlertEvaluator {
  /**
   * Starts the evaluations that are due and waits for them.
   *
   * @returns When every evaluation it started has finished.
   */
  tick(): Promise<void>;
}

/** The default caps: 8 evaluations at once, 2 per connector. */
const defaultCaps: LimiterCaps = { global: 8, perKey: 2 };

/** How often the job ticks, in milliseconds. */
const tickMs = 15_000;

/** How early an alert counts as due, so a tick that fires a little early does not skip it. */
const slackMs = 1000;

/**
 * Whether an alert is due.
 *
 * @param subject - The alert and its spec.
 * @param now - The current instant.
 * @returns `true` when it was never evaluated, or its interval has passed.
 */
export function isDue(subject: EvaluatedAlert, now: number): boolean {
  const last = subject.alert.evaluatedAt;
  return last === null || now - last >= durationMs(subject.spec.every) - slackMs;
}

/**
 * Lists the alerts, logging a failure as none.
 *
 * @param dependencies - The alerts and the logger.
 * @returns The alerts to evaluate.
 */
function listAlerts(dependencies: AlertEvaluatorDependencies): EvaluatedAlert[] {
  try {
    return dependencies.alerts.evaluated();
  } catch (error) {
    dependencies.logger.error('the alerts could not be listed', { error: String(error) });
    return [];
  }
}

/**
 * Creates the evaluator.
 *
 * @param dependencies - The alerts, the evaluation's dependencies, the logger, the caps and clock.
 * @returns The evaluator.
 */
export function createAlertEvaluator(dependencies: AlertEvaluatorDependencies): AlertEvaluator {
  const { logger } = dependencies;
  const clock = dependencies.now ?? Date.now;
  const evaluate = dependencies.evaluate ?? evaluateAlert;
  const limiter = createLimiter(dependencies.caps ?? defaultCaps);
  const evaluation = { ...dependencies.evaluation, logger };
  const running = new Set<string>();
  const run = async (subject: EvaluatedAlert) => {
    const alertId = subject.alert.id;
    running.add(alertId);
    try {
      await limiter.run(subject.spec.query.connector, () => evaluate(evaluation, subject, clock()));
    } catch (error) {
      logger.error('an alert evaluation failed', { alertId, error: String(error) });
    } finally {
      running.delete(alertId);
    }
  };
  return {
    async tick() {
      const now = clock();
      const due = listAlerts(dependencies).filter(
        (subject) => !running.has(subject.alert.id) && isDue(subject, now),
      );
      await Promise.all(due.map(run));
    },
  };
}

/**
 * Starts the evaluator: a tick now, then every 15 seconds.
 *
 * @param dependencies - The alerts, the evaluation's dependencies and the logger.
 * @returns Stops the job.
 */
export function startAlertEvaluator(dependencies: AlertEvaluatorDependencies): () => void {
  const evaluator = createAlertEvaluator(dependencies);
  const tick = () => void evaluator.tick();
  tick();
  const timer = setInterval(tick, tickMs);
  return () => clearInterval(timer);
}
