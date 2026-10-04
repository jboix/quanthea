/**
 * The orders of a period, counted on the dev Postgres directly, as the read-only role, with no
 * model and no connector in between: what a report's headline numbers are checked against.
 */
import { devPostgres } from '@quanthea/server/src/connectors/_shared/test/dev-sources.ts';
import { SQL } from 'bun';
import type { OrderTruth } from './report-score.ts';

/**
 * The dev Postgres as the read-only role.
 *
 * @returns Its URL.
 */
function postgresUrl(): string {
  const { username, host, port, database } = devPostgres.config;
  return `postgres://${username}:${devPostgres.secret.password}@${host}:${port}/${database}`;
}

/** One status's orders over the period. */
interface StatusRow {
  /** `paid`, `failed` or `refunded`. */
  readonly status: string;
  /** How many. */
  readonly orders: number;
  /** Their totals, in cents. */
  readonly cents: number;
}

/**
 * Counts the orders of a period by status, both ends kept, as a report's query over it does.
 *
 * @param period - The period, in epoch milliseconds, both ends kept.
 * @returns The counts and totals.
 */
export async function orderTruth(period: { from: number; to: number }): Promise<OrderTruth> {
  const sql = new SQL(postgresUrl());
  try {
    const rows: StatusRow[] = await sql`
      SELECT status, count(*)::float8 AS orders, coalesce(sum(total_cents), 0)::float8 AS cents
      FROM orders
      WHERE created_at BETWEEN ${new Date(period.from)} AND ${new Date(period.to)}
      GROUP BY status`;
    const of = (status: string) => rows.find((row) => row.status === status);
    const sum = (pick: (row: StatusRow) => number) =>
      rows.reduce((total, row) => total + pick(row), 0);
    return {
      paid: of('paid')?.orders ?? 0,
      all: sum((row) => row.orders),
      failed: of('failed')?.orders ?? 0,
      paidCents: of('paid')?.cents ?? 0,
      allCents: sum((row) => row.cents),
    };
  } finally {
    await sql.close();
  }
}
