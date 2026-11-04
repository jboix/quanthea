/**
 * Whether a connector answers now. The schema the model reads may come from the cache, so a run
 * checks this before it builds, and tells the person instead of failing panel by panel.
 */
import type { HealthReport } from '@quanthea/plugin-kit';

/** What the check needs of the connectors service: to open a connector and test it. */
interface Openable {
  /**
   * Opens a connector by name.
   *
   * @param name - The connector name.
   * @returns Its source, with the instance that tests it.
   */
  open(name: string): Promise<{
    readonly source: {
      readonly instance: { test(signal: AbortSignal): Promise<HealthReport> };
    };
  }>;
}

/** The model view's check of a connector. */
export interface ReachMethods {
  /**
   * Whether a connector answers now. Its health report is for the admin, so only the answer
   * leaves the gate.
   *
   * @param name - The connector.
   * @param signal - Aborted when the caller gives up.
   * @returns Whether it answered.
   */
  reach(name: string, signal: AbortSignal): Promise<boolean>;
}

/**
 * The check of a connector, on the connectors service.
 *
 * @param access - What the connectors service provides.
 * @returns The method.
 */
export function reachMethods(access: Openable): ReachMethods {
  return {
    async reach(name, signal) {
      const opened = await access.open(name).catch(() => undefined);
      if (!opened) return false;
      const report = await opened.source.instance.test(signal).catch(() => undefined);
      return report?.ok === true;
    },
  };
}
