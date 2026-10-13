/**
 * The cases seen unstable, kept between runs: a case's file says what it checks, and this book
 * says what was observed of it. A run with trials writes each case's fraction, its day and its
 * models here. A later run reads the book to set those cases apart, and a comparison of two runs
 * does not mark their changes. The maintainer may settle a case by hand with `stable`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type CaseResult, fractionOf } from '../core/result.ts';
import type { EvalModels } from '../world/setup.ts';

/** What trials of a case showed, the last time it had several. */
export interface Observed {
  /** The trials that passed. */
  readonly pass: number;
  /** The trials that said something of the product. */
  readonly of: number;
  /** The day of the run. */
  readonly date: string;
  /** The maintainer's word, which stands over the fraction: `true` or `false`. */
  readonly stable?: boolean;
}

/** The book: what was observed of each case, by the models that ran it, then by case id. */
export type UnstableBook = Readonly<Record<string, Readonly<Record<string, Observed>>>>;

/**
 * The name the book keeps a run's models under.
 *
 * @param models - The models.
 * @returns Such as `anthropic claude-haiku-4-5 claude-sonnet-5`.
 */
export function modelsKey(models: EvalModels): string {
  return [models.provider ?? 'google', models.model, models.build].filter(Boolean).join(' ');
}

/**
 * Reads the book.
 *
 * @param path - Its file.
 * @returns The book; an empty one when the file is missing.
 */
export function readBook(path: string): UnstableBook {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as UnstableBook) : {};
}

/**
 * The book with what a run's trials showed: each case that had two counted trials or more gets
 * its fraction and the day, and keeps the maintainer's word.
 *
 * @param book - The book.
 * @param models - The run's models.
 * @param results - The run's results.
 * @param date - The day of the run.
 * @returns The book, with the run's observations.
 */
export function observed(
  book: UnstableBook,
  models: EvalModels,
  results: readonly CaseResult[],
  date: string,
): UnstableBook {
  const key = modelsKey(models);
  const cases = { ...book[key] };
  for (const result of results) {
    const { pass, of } = fractionOf(result);
    if (of < 2) continue;
    const { stable } = cases[result.id] ?? {};
    cases[result.id] = { pass, of, date, ...(stable === undefined ? {} : { stable }) };
  }
  return { ...book, [key]: cases };
}

/**
 * Writes the book.
 *
 * @param path - Its file.
 * @param book - The book.
 */
export function writeBook(path: string, book: UnstableBook): void {
  writeFileSync(path, `${JSON.stringify(book, null, 2)}\n`);
}

/**
 * The cases the book holds as unstable for some models: those whose trials disagreed, unless the
 * maintainer says they are stable, and those the maintainer says are not.
 *
 * @param book - The book.
 * @param models - The models.
 * @returns Each case's id with its fraction and day, such as `q11 (3/5 on 2026-10-12)`.
 */
export function knownUnstable(book: UnstableBook, models: EvalModels): string[] {
  const unstable = (seen: Observed) =>
    seen.stable === undefined ? seen.pass > 0 && seen.pass < seen.of : !seen.stable;
  return Object.entries(book[modelsKey(models)] ?? {})
    .filter(([, seen]) => unstable(seen))
    .map(([id, seen]) => `${id} (${seen.pass}/${seen.of} on ${seen.date})`);
}
