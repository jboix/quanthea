/** What the last application of the configuration file left for admins to see. */

/** The state of the configuration file. */
export interface ProvisioningStatus {
  /** Why the last change to the file was not applied, or `null` when it was. */
  problem(): string | null;
  /** The system settings changed in the file since startup, which apply at the next restart. */
  restartNeeded(): readonly string[];
  /**
   * Records the outcome of applying the file.
   *
   * @param problem - Why it was not applied, or `null` when it was.
   */
  setProblem(problem: string | null): void;
  /**
   * Records the system settings that changed since startup.
   *
   * @param keys - Their names in the `server` section.
   */
  setRestartNeeded(keys: readonly string[]): void;
}

/**
 * Creates the status, with nothing wrong.
 *
 * @returns The status.
 */
export function createProvisioningStatus(): ProvisioningStatus {
  let problem: string | null = null;
  let restartNeeded: readonly string[] = [];
  return {
    problem: () => problem,
    restartNeeded: () => restartNeeded,
    setProblem: (next) => {
      problem = next;
    },
    setRestartNeeded: (keys) => {
      restartNeeded = keys;
    },
  };
}
