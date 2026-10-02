/**
 * The questions the generator asks, as data: each one's flag, choices, default and check. Flags
 * answer them without prompts; the interactive run asks the rest. Both go through the same checks.
 */
import {
  kindPattern,
  pluginNamePattern,
  type QueryLanguage,
  queryLanguages,
  sqlDialects,
  sqlPlaceholderStyles,
  sqlRowLimits,
} from '@quanthea/plugin-kit/contract';
import { dialectLabels, languageLabels, placeholderLabels, rowLimitLabels } from './labels.ts';

/** The answers a project is generated from. */
export interface Answers {
  /** The npm package name. */
  readonly name: string;
  /** The connector kind identifier. */
  readonly kind: string;
  /** The kind's name in the interface. */
  readonly displayName: string;
  /** The query language the kind speaks. */
  readonly language: QueryLanguage;
  /** For SQL, the dialect. */
  readonly dialect?: string;
  /** For the `ansi` dialect, the placeholder style. */
  readonly placeholders?: string;
  /** For the `ansi` dialect, the row-limit style. */
  readonly rowLimit?: string;
  /** Who holds the copyright, for the licence. */
  readonly author: string;
}

/** A field of the answers. */
export type Field = keyof Answers;

/** Answers given so far, as text. */
export type Draft = Partial<Record<Field, string>>;

/** One question. */
export interface Question {
  /** The answer it fills. */
  readonly field: Field;
  /** The command-line flag that answers it. */
  readonly flag: string;
  /** What it asks. */
  readonly message: string;
  /** The answers it accepts, when it is a choice. */
  readonly choices?: readonly string[];
  /** What each choice shows in a prompt, by value: what it means in plain words. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Its default, from the answers before it. */
  readonly fallback?: (draft: Draft) => string | undefined;
  /** Whether it is asked, from the answers before it. */
  readonly applies?: (draft: Draft) => boolean;
  /** Why an answer is refused, if it is. */
  readonly problem?: (value: string) => string | undefined;
}

/** A wrong answer given as a flag, or a missing one in a run without prompts. */
export class UsageError extends Error {}

/** Asks one question, with its default. */
export type Ask = (question: Question, fallback: string | undefined) => Promise<string>;

/**
 * The kind identifier a package name suggests: the name without its scope and prefix.
 *
 * @param name - The package name.
 * @returns The identifier, when the rest of the name makes one.
 */
function kindFromName(name: string | undefined): string | undefined {
  const kind = name?.replace(/^@[^/]+\//, '').replace(/^quanthea-plugin-/, '');
  return kind !== undefined && kindPattern.test(kind) ? kind : undefined;
}

/**
 * A display name from a kind identifier: words, the first one capitalised.
 *
 * @param kind - The identifier.
 * @returns The display name.
 */
function nameFromKind(kind: string | undefined): string | undefined {
  if (!kind) return undefined;
  const words = kind.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Whether the answers so far chose SQL.
 *
 * @param draft - The answers so far.
 * @returns Whether the language is SQL.
 */
const isSql = (draft: Draft) => draft.language === 'sql';

/**
 * Whether the answers so far chose the `ansi` SQL dialect.
 *
 * @param draft - The answers so far.
 * @returns Whether the dialect is `ansi`.
 */
const isAnsi = (draft: Draft) => isSql(draft) && draft.dialect === 'ansi';

/** The package name. */
const nameQuestion: Question = {
  field: 'name',
  flag: 'name',
  message: 'npm package name (for example quanthea-plugin-duckdb):',
  problem: (value) =>
    pluginNamePattern.test(value)
      ? undefined
      : 'Name it quanthea-plugin-<name> or @scope/quanthea-plugin-<name>.',
};

/** The kind identifier, suggested by the package name. */
const kindQuestion: Question = {
  field: 'kind',
  flag: 'kind',
  message: 'Short id for this kind of connector (lowercase letters, digits, dashes):',
  fallback: (draft) => kindFromName(draft.name),
  problem: (value) =>
    kindPattern.test(value)
      ? undefined
      : 'Use lowercase letters, digits and dashes, starting with a letter, up to 40.',
};

/** The display name, suggested by the kind identifier. */
const displayNameQuestion: Question = {
  field: 'displayName',
  flag: 'display-name',
  message: 'Name people see in quanthea when they add this connector:',
  fallback: (draft) => nameFromKind(draft.kind),
  problem: (value) => {
    if (value.trim().length === 0 || value.length > 60)
      return 'Give it a name of 1 to 60 characters.';
    return value.includes('*/') ? 'Leave out */.' : undefined;
  },
};

/** The query language and, for SQL, the dialect and the ansi styles. */
const languageQuestions: readonly Question[] = [
  {
    field: 'language',
    flag: 'language',
    message: 'Which query language does your data source understand?',
    choices: queryLanguages,
    labels: languageLabels,
  },
  {
    field: 'dialect',
    flag: 'dialect',
    message: 'Which SQL does your database speak?',
    choices: sqlDialects,
    labels: dialectLabels,
    fallback: () => 'ansi',
    applies: isSql,
  },
  {
    field: 'placeholders',
    flag: 'placeholders',
    message:
      "How does your database's driver mark where a value goes in a query? Check its docs if unsure.",
    choices: sqlPlaceholderStyles,
    labels: placeholderLabels,
    applies: isAnsi,
  },
  {
    field: 'rowLimit',
    flag: 'row-limit',
    message: 'How does your database cap the number of rows a query returns?',
    choices: sqlRowLimits,
    labels: rowLimitLabels,
    applies: isAnsi,
  },
];

/**
 * The questions, in the order they are asked.
 *
 * @param gitName - The git user name, the licence's default holder.
 * @returns The questions.
 */
export function questionsFor(gitName: string | undefined): readonly Question[] {
  const author: Question = {
    field: 'author',
    flag: 'author',
    message: 'Your name, for the MIT licence:',
    fallback: () => gitName,
    problem: (value) => (value.trim().length > 0 ? undefined : 'Give a name.'),
  };
  return [nameQuestion, kindQuestion, displayNameQuestion, ...languageQuestions, author];
}

/**
 * The choices a prompt lists: each value with its label, if it has one.
 *
 * @param question - A question with choices.
 * @returns The choices, as the prompt library takes them.
 */
export function choicesFor(question: Question): { name: string; value: string }[] {
  return (question.choices ?? []).map((value) => ({
    name: question.labels?.[value] ?? value,
    value,
  }));
}

/**
 * Why an answer is refused, if it is: not one of the choices, or failing the question's check.
 *
 * @param question - The question.
 * @param value - The answer.
 * @returns The problem, if any.
 */
export function problemOf(question: Question, value: string): string | undefined {
  if (question.choices && !question.choices.includes(value))
    return `Choose one of ${question.choices.join(', ')}.`;
  return question.problem?.(value);
}

/**
 * One answer: the flag's, else the one asked, else the default in a run without prompts.
 *
 * @param question - The question.
 * @param given - The flags.
 * @param draft - The answers before it.
 * @param ask - Asks a question, in an interactive run.
 * @returns The answer.
 * @throws {UsageError} When a flag's answer is refused, or a run without prompts has none.
 */
async function answer(question: Question, given: Draft, draft: Draft, ask?: Ask): Promise<string> {
  const fallback = question.fallback?.(draft) ?? question.choices?.[0];
  const flagged = given[question.field];
  const value = flagged ?? (ask ? await ask(question, fallback) : fallback);
  if (value === undefined) throw new UsageError(`Give --${question.flag}.`);
  const problem = problemOf(question, value);
  if (problem) throw new UsageError(`--${question.flag} ${value}: ${problem}`);
  return value;
}

/**
 * Every answer, from the flags and, in an interactive run, the person.
 *
 * @param questions - The questions.
 * @param given - The flags.
 * @param ask - Asks a question; without it, defaults answer what the flags leave out.
 * @returns The answers.
 * @throws {UsageError} When an answer is refused or missing, or a flag answers a question these
 *   answers do not ask.
 */
export async function resolveAnswers(
  questions: readonly Question[],
  given: Draft,
  ask?: Ask,
): Promise<Answers> {
  const draft: Draft = {};
  for (const question of questions) {
    if (question.applies && !question.applies(draft)) {
      if (given[question.field] !== undefined)
        throw new UsageError(`--${question.flag} does not apply to these answers.`);
      continue;
    }
    draft[question.field] = await answer(question, given, draft, ask);
  }
  return draft as unknown as Answers;
}
