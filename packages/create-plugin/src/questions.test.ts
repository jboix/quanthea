import { describe, expect, test } from 'bun:test';
import { type Draft, questionsFor, resolveAnswers } from './questions.ts';

/**
 * Resolves answers without prompts, the git user being Ada.
 *
 * @param given - The flags.
 * @returns The answers.
 */
function resolve(given: Draft) {
  return resolveAnswers(questionsFor('Ada Lovelace'), given);
}

describe('the questions', () => {
  test('take the defaults: the kind from the name, SQL in the ansi dialect, git for the licence', async () => {
    expect(await resolve({ name: '@acme/quanthea-plugin-duck-lake' })).toEqual({
      name: '@acme/quanthea-plugin-duck-lake',
      kind: 'duck-lake',
      displayName: 'Duck lake',
      language: 'sql',
      dialect: 'ansi',
      placeholders: '?',
      rowLimit: 'fetch',
      author: 'Ada Lovelace',
    });
  });

  test('ask nothing about SQL for another language, and no styles for a built-in dialect', async () => {
    expect(await resolve({ name: 'quanthea-plugin-x', language: 'promql' })).not.toHaveProperty(
      'dialect',
    );
    const postgres = await resolve({ name: 'quanthea-plugin-x', dialect: 'postgres' });
    expect(postgres).toMatchObject({ dialect: 'postgres' });
    expect(postgres).not.toHaveProperty('placeholders');
  });

  test('refuse a wrong, missing or misplaced answer, naming the flag', async () => {
    await expect(resolve({ name: 'lodash' })).rejects.toThrow('--name lodash: Name it');
    await expect(resolve({ name: 'quanthea-plugin-x', language: 'cobol' })).rejects.toThrow(
      '--language cobol: Choose one of sql, promql',
    );
    await expect(resolve({})).rejects.toThrow('Give --name.');
    await expect(resolve({ name: 'quanthea-plugin-1x' })).rejects.toThrow('Give --kind.');
    await expect(resolve({ name: 'quanthea-plugin-x', displayName: 'a */ b' })).rejects.toThrow(
      'Leave out */.',
    );
    await expect(
      resolve({ name: 'quanthea-plugin-x', dialect: 'postgres', placeholders: '?' }),
    ).rejects.toThrow('--placeholders does not apply');
    await expect(
      resolveAnswers(questionsFor(undefined), { name: 'quanthea-plugin-x' }),
    ).rejects.toThrow('Give --author.');
  });

  test('ask only what the flags leave out, with each question’s default', async () => {
    const asked: string[] = [];
    const answers = await resolveAnswers(
      questionsFor(undefined),
      { name: 'quanthea-plugin-x', language: 'http' },
      async (question, fallback) => {
        asked.push(question.field);
        return fallback ?? 'Grace Hopper';
      },
    );
    expect(asked).toEqual(['kind', 'displayName', 'author']);
    expect(answers).toMatchObject({ kind: 'x', displayName: 'X', author: 'Grace Hopper' });
  });
});
