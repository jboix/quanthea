/**
 * Applying what the configuration file declares, one kind of item at a time. An item is applied
 * when it is new or changed since it was last applied, which a keyed hash of its declaration
 * tells. An item the file no longer declares is released (it stays, editable again), or deleted
 * when the file says `prune: true`.
 */
import type { AuditRepository } from '../db/audit-repository.ts';
import type {
  ProvisionedKind,
  ProvisionedRepository,
  ProvisionedRow,
} from '../db/provisioned-repository.ts';
import type { Logger } from '../lib/logger.ts';
import type { KeyedHash } from '../secrets/keyed-hash.ts';

/** The actor of every change the file makes. */
export const provisioningActor = 'provisioning';

/** What applying the file needs. */
export interface ProvisioningContext {
  /** Records what the file manages. */
  readonly repository: ProvisionedRepository;
  /** Hashes declarations, under a key the database does not hold. */
  readonly fingerprints: KeyedHash;
  /** Records who did what. */
  readonly audit: AuditRepository;
  /** Receives what happened. */
  readonly logger: Logger;
  /** Whether items the file no longer declares are deleted. */
  readonly prune: boolean;
  /** The clock. */
  readonly now: () => number;
}

/** An item as the file declares it, ready to apply. */
export interface Planned<Desired> {
  /** Its name. */
  readonly name: string;
  /** The file that declares it. */
  readonly path: string;
  /** What it should be. */
  readonly desired: Desired;
  /** The fields the file leaves to the interface. */
  readonly editable: readonly string[];
}

/** How to apply one kind of item. */
export interface Applier<Desired> {
  /** The kind. */
  readonly kind: ProvisionedKind;
  /**
   * Whether the item exists, so an unchanged one that was deleted meanwhile is made again.
   *
   * @param name - The item.
   * @returns Whether it exists.
   */
  exists(name: string): boolean;
  /**
   * Creates or updates the item.
   *
   * @param item - The item as declared.
   * @returns Once it is applied.
   */
  apply(item: Planned<Desired>): Promise<void>;
  /**
   * Deletes an item the file no longer declares, when pruning.
   *
   * @param name - The item.
   * @returns Once it is deleted.
   */
  remove(name: string): Promise<void>;
}

/**
 * Writes a value as JSON with its keys sorted, so equal values give equal text.
 *
 * @param value - The value.
 * @returns The JSON text.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, each]) => each !== undefined);
    entries.sort(([first], [second]) => (first < second ? -1 : 1));
    return `{${entries.map(([key, each]) => `${JSON.stringify(key)}:${canonical(each)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The keyed hash of a declaration. Secrets are part of it, so a changed secret is applied, and
 * the key keeps the hash from revealing them.
 *
 * @param context - The context.
 * @param kind - The item's kind.
 * @param item - The item.
 * @returns The hash.
 */
function fingerprintOf<Desired>(
  context: ProvisioningContext,
  kind: ProvisionedKind,
  item: Planned<Desired>,
): Promise<Uint8Array> {
  const declared = canonical({ desired: item.desired, editable: item.editable });
  return context.fingerprints.hash(`provisioning:${kind}:${item.name}:${declared}`);
}

/**
 * Whether two byte arrays are equal.
 *
 * @param first - One.
 * @param second - The other.
 * @returns Whether they are.
 */
function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}

/**
 * Applies one item when it is new, changed, or missing.
 *
 * @param context - The context.
 * @param applier - How to apply the kind.
 * @param item - The item.
 * @returns Whether it was applied.
 */
async function applyOne<Desired>(
  context: ProvisioningContext,
  applier: Applier<Desired>,
  item: Planned<Desired>,
): Promise<boolean> {
  const fingerprint = await fingerprintOf(context, applier.kind, item);
  const recorded = context.repository.get(applier.kind, item.name);
  const unchanged = recorded && sameBytes(recorded.fingerprint, fingerprint);
  if (unchanged && recorded.path === item.path && applier.exists(item.name)) return false;
  await applier.apply(item);
  const row: ProvisionedRow = {
    kind: applier.kind,
    name: item.name,
    path: item.path,
    fingerprint,
    editable: item.editable,
    appliedAt: context.now(),
  };
  context.repository.put(row);
  return true;
}

/**
 * Releases, or deletes when pruning, an item the file no longer declares.
 *
 * @param context - The context.
 * @param applier - How to apply the kind.
 * @param row - What was recorded of it.
 * @returns Once it is done.
 */
async function letGo<Desired>(
  context: ProvisioningContext,
  applier: Applier<Desired>,
  row: ProvisionedRow,
): Promise<void> {
  const target = `${row.kind}:${row.name}`;
  if (context.prune && applier.exists(row.name)) await applier.remove(row.name);
  else context.audit.append({ actor: provisioningActor, action: 'provisioning.released', target });
  context.repository.remove(row.kind, row.name);
  context.logger.info(context.prune ? 'pruned' : 'released from the configuration file', {
    kind: row.kind,
    name: row.name,
  });
}

/**
 * Applies each item, reporting a failing one while the others still apply.
 *
 * @param context - The context.
 * @param applier - How to apply the kind.
 * @param items - The items the file declares.
 * @returns What went wrong, one sentence per item.
 */
async function applyAll<Desired>(
  context: ProvisioningContext,
  applier: Applier<Desired>,
  items: readonly Planned<Desired>[],
): Promise<string[]> {
  const issues: string[] = [];
  for (const item of items) {
    try {
      if (!(await applyOne(context, applier, item))) continue;
      context.logger.info('applied from the configuration file', {
        kind: applier.kind,
        name: item.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`${applier.kind} ${item.name}: ${message}`);
    }
  }
  return issues;
}

/**
 * Applies every item of a kind, then lets go of those the file no longer declares.
 *
 * @param context - The context.
 * @param applier - How to apply the kind.
 * @param items - The items the file declares.
 * @returns What went wrong, one sentence per item.
 */
export async function reconcile<Desired>(
  context: ProvisioningContext,
  applier: Applier<Desired>,
  items: readonly Planned<Desired>[],
): Promise<string[]> {
  const issues = await applyAll(context, applier, items);
  const declared = new Set(items.map((item) => item.name));
  for (const row of context.repository.list(applier.kind)) {
    if (!declared.has(row.name)) await letGo(context, applier, row);
  }
  return issues;
}
