import { describe, expect, test } from 'bun:test';
import { draftOf, guessKind, idOf, newDraft, paramsOf, recipeOf } from './query-draft.ts';

describe('recipe drafts', () => {
  test('guess each placeholder’s kind from its name', () => {
    expect(paramsOf(newDraft)).toEqual([
      { name: 'label', kind: 'label', description: '' },
      { name: 'metric', kind: 'metric', description: '' },
      { name: 'window', kind: 'duration', description: '' },
    ]);
    expect(guessKind('status')).toBe('value');
  });

  test('make an id from a name', () => {
    expect(idOf(' Queue depth (p95)! ')).toBe('queue-depth-p95');
  });

  test('check a draft and come back to it from the recipe', () => {
    const draft = {
      ...newDraft,
      id: 'rate-by',
      name: 'Rate by label',
      description: 'A counter per second by a label.',
    };
    const checked = recipeOf(draft);
    if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
    expect(checked.recipe.params.map((param) => param.kind)).toEqual([
      'label',
      'metric',
      'duration',
    ]);
    expect(draftOf(checked.recipe).params.window).toEqual({ kind: 'duration', description: '' });
  });

  test('say what is missing, by field', () => {
    const checked = recipeOf(newDraft);
    expect(checked.ok).toBe(false);
    expect(checked.ok ? {} : checked.issues).toMatchObject({
      name: 'Name the query.',
      description: 'Say what it returns.',
    });
  });
});
