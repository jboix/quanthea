import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Conversation, type ConversationContext } from './conversation.tsx';
import { limitPhrase } from './limit-card.tsx';
import type { ThreadMessage } from './messages.ts';
import { connectorList } from './unreachable-card.tsx';

/** The thread's actions and state, none of them used. */
const context: ConversationContext = {
  plans: [],
  levels: {},
  latestVersion: 0,
  busy: false,
  onApprove: () => {},
  onEditPlan: () => {},
  onUndo: () => {},
  onCompare: () => {},
  onAnswer: () => {},
  onStartFrom: () => {},
  onBuildNew: () => {},
  onTryAgain: () => {},
  hasDraft: false,
};

/** A call that reads a connector. */
const describeCall = {
  type: 'tool-describe',
  toolCallId: 'call-1',
  state: 'output-available',
  input: { connector: 'events' },
  output: { ok: true, entities: [], more: 0 },
};

/**
 * The markup of one answer of the agent.
 *
 * @param parts - The answer's parts.
 * @returns The markup.
 */
function answerOf(parts: unknown[]): string {
  const message = { id: 'a1', role: 'assistant', parts } as unknown as ThreadMessage;
  return renderToStaticMarkup(<Conversation messages={[message]} {...context} />);
}

test('text the agent wrote on its way shows quieter than its answer', () => {
  const html = answerOf([
    { type: 'text', text: 'Fixing the column option shape.' },
    describeCall,
    { type: 'text', text: 'Built it.' },
  ]);
  expect(html).toMatch(/data-narration="true"[^>]*><p>Fixing the column option shape\./);
  expect(html).toContain('<div><p>Built it.</p></div>');
});

test('a turn paused at a limit offers Continue until something follows it', () => {
  const limit = { type: 'data-limit', data: { kind: 'calls', limit: 25, used: 25 } };
  const paused = answerOf([describeCall, limit]);
  expect(paused).toContain('Paused after 25 tool calls');
  expect(paused).toContain('Continue</button>');
  const continued = answerOf([describeCall, limit, describeCall, { type: 'text', text: 'Done.' }]);
  expect(continued).toContain('Paused after 25 tool calls');
  expect(continued).not.toContain('Continue</button>');
});

test('a token limit names the tokens', () => {
  expect(limitPhrase({ kind: 'tokens', limit: 500_000, used: 512_345 })).toBe('512,345 tokens');
  expect(limitPhrase({ kind: 'calls', limit: 1, used: 1 })).toBe('1 tool call');
});

test('a build whose connectors do not answer warns, and offers Try again until it builds', () => {
  const unreachable = { type: 'data-unreachable', data: { connectors: ['postgres-orders'] } };
  const stopped = answerOf([unreachable]);
  expect(stopped).toContain('data-outcome="exhausted"');
  expect(stopped).toContain('postgres-orders does not answer');
  expect(stopped).toContain('Try again</button>');
  const built = answerOf([unreachable, describeCall, { type: 'text', text: 'Built it.' }]);
  expect(built).toContain('postgres-orders does not answer');
  expect(built).not.toContain('Try again</button>');
});

test('several connectors are named in one sentence', () => {
  expect(connectorList(['orders', 'logs', 'metrics'])).toBe('orders, logs and metrics');
  expect(connectorList(['orders'])).toBe('orders');
});
