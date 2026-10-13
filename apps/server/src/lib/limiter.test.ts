import { describe, expect, test } from 'bun:test';
import { createLimiter } from './limiter.ts';

/**
 * A task that waits to be let go, and says when it started.
 *
 * @param started - Collects the names of the tasks that started.
 * @param name - Its name.
 * @returns The task, and the function that lets it finish.
 */
function held(started: string[], name: string) {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const task = () => {
    started.push(name);
    return done;
  };
  return { task, finish };
}

/** Lets the tasks that can start do so. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the limiter', () => {
  test('runs at most the cap of tasks per key, the rest in order as room comes', async () => {
    const limiter = createLimiter({ global: 8, perKey: 1 });
    const started: string[] = [];
    const first = held(started, 'first');
    const second = held(started, 'second');
    const other = held(started, 'other');
    const all = [
      limiter.run('a', first.task),
      limiter.run('a', second.task),
      limiter.run('b', other.task),
    ];
    await settle();
    expect(started).toEqual(['first', 'other']);
    first.finish();
    await settle();
    expect(started).toEqual(['first', 'other', 'second']);
    second.finish();
    other.finish();
    await Promise.all(all);
  });

  test('starts a task on two keys once both have room, and holds both while it runs', async () => {
    const limiter = createLimiter({ global: 8, perKey: 1 });
    const started: string[] = [];
    const onA = held(started, 'a');
    const both = held(started, 'a and b');
    const onB = held(started, 'b');
    const all = [
      limiter.run('a', onA.task),
      limiter.run(['a', 'b'], both.task),
      limiter.run(['b', 'b'], onB.task),
    ];
    await settle();
    expect(started).toEqual(['a', 'b']);
    onA.finish();
    await settle();
    expect(started).toEqual(['a', 'b']);
    onB.finish();
    await settle();
    expect(started).toEqual(['a', 'b', 'a and b']);
    const next = held(started, 'next on b');
    all.push(limiter.run('b', next.task));
    await settle();
    expect(started).toHaveLength(3);
    both.finish();
    next.finish();
    await Promise.all(all);
    expect(started).toEqual(['a', 'b', 'a and b', 'next on b']);
  });

  test('two tasks on the same two keys never wait for each other', async () => {
    const limiter = createLimiter({ global: 1, perKey: 1 });
    const order: string[] = [];
    const run = (name: string, keys: string[]) =>
      limiter.run(keys, async () => {
        order.push(name);
      });
    await Promise.all([run('one', ['a', 'b']), run('two', ['b', 'a']), run('three', ['a'])]);
    expect(order).toEqual(['one', 'two', 'three']);
  });
});
