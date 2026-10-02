/**
 * Generates a plugin project with node-plop: the questions through its prompts, the files from
 * the Handlebars templates. A run writes into a new folder and refuses one that holds files.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import nodePlop, { type ActionType, type DynamicPromptsFunction } from 'node-plop';
import { languageText } from './languages.ts';
import {
  type Answers,
  type Ask,
  choicesFor,
  type Draft,
  problemOf,
  questionsFor,
  resolveAnswers,
  UsageError,
} from './questions.ts';

/** The prompt library node-plop hands a prompts function. */
type Inquirer = Parameters<DynamicPromptsFunction>[0];

/** The tool versions a generated project starts with. */
export interface Versions {
  /** Bun, for `.tool-versions` and CI. */
  readonly bun: string;
  /** Biome. */
  readonly biome: string;
  /** TypeScript, as a range. */
  readonly typescript: string;
  /** Bun's types. */
  readonly typesBun: string;
}

/** How a run generates. */
export interface Setup {
  /** The templates folder. */
  readonly templates: string;
  /** The folder the project folder is made in. */
  readonly cwd: string;
  /** The project folder, relative to `cwd`; the package name without its scope by default. */
  readonly dir?: string | undefined;
  /** The `@quanthea/plugin-kit` dependency, such as `^0.2.0`. */
  readonly kit: string;
  /** The tool versions. */
  readonly versions: Versions;
  /** The licence's year. */
  readonly year: number;
  /** The git user name, the licence's default holder. */
  readonly gitName?: string | undefined;
  /** Whether to ask what the flags leave out; otherwise defaults answer it. */
  readonly interactive: boolean;
}

/** What a run made. */
export interface Created {
  /** The answers. */
  readonly answers: Answers;
  /** The project folder. */
  readonly folder: string;
}

/**
 * The project folder for some answers.
 *
 * @param answers - The answers.
 * @param setup - The run's setup.
 * @returns The absolute folder.
 */
function folderFor(answers: Answers, setup: Setup): string {
  return resolve(setup.cwd, setup.dir ?? answers.name.replace(/^@[^/]+\//, ''));
}

/**
 * Asks with node-plop's prompts: a list for a choice, else a checked text answer.
 *
 * @param inquirer - The prompt library.
 * @returns The asker.
 */
function askWith(inquirer: Inquirer): Ask {
  return async (question, fallback) => {
    const kind = question.choices
      ? { type: 'list', choices: choicesFor(question), pageSize: 10 }
      : { type: 'input', validate: (value: string) => problemOf(question, value) ?? true };
    const prompt = { name: 'value', message: question.message, default: fallback, ...kind };
    const answered = await inquirer.prompt([prompt] as Parameters<Inquirer['prompt']>[0]);
    return String(answered.value);
  };
}

/**
 * A string as TypeScript source, quoted the way Biome writes it: single quotes, unless the text
 * holds a single quote and no double one.
 *
 * @param value - The text.
 * @returns The string literal.
 */
export function tsString(value: string): string {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  const escaped = value.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`);
  return `${quote}${escaped.replaceAll('\n', '\\n')}${quote}`;
}

/**
 * What the templates read: the answers, the language's text, the kit and the tool versions.
 *
 * @param answers - The answers.
 * @param setup - The run's setup.
 * @returns The template data.
 */
export function templateData(answers: Answers, setup: Setup): Record<string, unknown> {
  return {
    ...answers,
    sql: answers.language === 'sql',
    ansi: answers.dialect === 'ansi',
    text: languageText[answers.language],
    description: `A quanthea plugin: the ${answers.displayName} connector kind.`,
    tarball: `${answers.name.replace(/^@/, '').replaceAll('/', '-')}-0.1.0.tgz`,
    kit: setup.kit,
    versions: setup.versions,
    year: setup.year,
  };
}

/**
 * The actions that write a project: every file of `templates/project`, and `.gitignore`, which
 * npm leaves out of a published package and so is kept beside it under another name.
 *
 * @param answers - The answers.
 * @param setup - The run's setup.
 * @returns The actions.
 */
function actionsFor(answers: Answers, setup: Setup): ActionType[] {
  const folder = folderFor(answers, setup);
  const data = templateData(answers, setup);
  return [
    {
      type: 'addMany',
      destination: folder,
      base: join(setup.templates, 'project'),
      templateFiles: join(setup.templates, 'project', '**'),
      globOptions: { dot: true },
      stripExtensions: ['hbs'],
      data,
      abortOnFail: true,
    },
    {
      type: 'add',
      path: join(folder, '.gitignore'),
      templateFile: join(setup.templates, 'gitignore.hbs'),
      data,
      abortOnFail: true,
    },
  ];
}

/**
 * Refuses a project folder that already holds files.
 *
 * @param folder - The folder.
 * @throws {UsageError} When it holds files.
 */
function checkFolderIsFree(folder: string): void {
  if (existsSync(folder) && readdirSync(folder).length > 0)
    throw new UsageError(`${folder} holds files already. Choose another folder with --dir.`);
}

/**
 * Generates a project: the answers from the flags and, in an interactive run, the person, then
 * the files.
 *
 * @param given - The answers the flags give.
 * @param setup - The run's setup.
 * @returns The answers and the project folder.
 * @throws {UsageError} When an answer is refused or missing, or the folder holds files.
 */
export async function createPlugin(given: Draft, setup: Setup): Promise<Created> {
  const plop = await nodePlop(undefined, { destBasePath: setup.cwd, force: false });
  plop.setHelper('json', (value: unknown) => JSON.stringify(value));
  plop.setHelper('tsString', tsString);
  const questions = questionsFor(setup.gitName);
  plop.setGenerator('plugin', {
    description: 'A quanthea plugin project',
    prompts: async (inquirer) =>
      resolveAnswers(questions, given, setup.interactive ? askWith(inquirer) : undefined),
    actions: (answers) => actionsFor(answers as Answers, setup),
  });
  const generator = plop.getGenerator('plugin');
  const answers = (await generator.runPrompts()) as Answers;
  const folder = folderFor(answers, setup);
  checkFolderIsFree(folder);
  const { failures } = await generator.runActions(answers);
  if (failures.length > 0)
    throw new Error(failures.map((failure) => failure.error || failure.path).join('\n'));
  return { answers, folder };
}
