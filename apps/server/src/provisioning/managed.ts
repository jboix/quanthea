/** What the configuration file manages, for the routes that must refuse to change it. */
import type { ProvisionedKind, ProvisionedRepository } from '../db/provisioned-repository.ts';
import { AppError } from '../lib/errors.ts';

/** What the file manages. */
export interface Managed {
  /**
   * The file that manages an item.
   *
   * @param kind - The item's kind.
   * @param name - Its name.
   * @returns The file's path, or `undefined` when the interface manages it.
   */
  pathOf(kind: ProvisionedKind, name: string): string | undefined;
  /**
   * Refuses a change to an item the file manages, unless it touches only fields the file leaves
   * to the interface.
   *
   * @param kind - The item's kind.
   * @param name - Its name.
   * @param fields - The fields the change touches; all of them when omitted.
   * @throws {AppError} `forbidden` naming the file to change instead.
   */
  refuseChange(kind: ProvisionedKind, name: string, fields?: readonly string[]): void;
}

/**
 * Creates the view of what the file manages.
 *
 * @param repository - What the file manages, as recorded.
 * @returns The view.
 */
export function createManaged(repository: ProvisionedRepository): Managed {
  return {
    pathOf: (kind, name) => repository.get(kind, name)?.path,
    refuseChange: (kind, name, fields) => {
      const row = repository.get(kind, name);
      if (!row) return;
      const open = fields?.every((field) => row.editable.includes(field)) === true;
      if (!open) throw new AppError('forbidden', `${row.path} manages this. Change it there.`);
    },
  };
}
