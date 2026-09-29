/** The streamed chat endpoint of a thread. It answers with an AI SDK UI message stream. Editors. */
import { apiPrefix, threadChatPath } from '@querent/shared';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Agent } from '../../agent/run.ts';
import { AppError } from '../../lib/errors.ts';
import type { Threads } from '../../threads/threads.ts';
import { accessMiddleware } from '../access.ts';
import type { AppEnv } from '../app-env.ts';
import { checkThread } from '../ownership.ts';
import { actorOf, signedIn } from '../principal.ts';

/** Validates the chat request body: one message, the new one or the one to continue. */
const chatBodySchema = z.object({ message: z.unknown() });

/**
 * Mounts the chat endpoint. It streams, so it is not a JSON endpoint, but it declares its access
 * the same way.
 *
 * @param app - The app.
 * @param agent - The agent.
 * @param threads - The threads, to check the person owns the thread.
 */
export function mountChatRoute(
  app: Hono<AppEnv>,
  agent: Agent,
  threads: Pick<Threads, 'row'>,
): void {
  app.post(`${apiPrefix}${threadChatPath}`, accessMiddleware('editor'), async (context) => {
    const parsed = chatBodySchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success)
      throw new AppError('bad_request', 'The request body is not a chat request.');
    const threadId = context.req.param('threadId') ?? '';
    // Only its owner writes in a thread; an admin reading it gets a refusal here.
    checkThread(threads, signedIn(context.get('principal')), threadId, 'write');
    return agent.chat({
      threadId,
      message: parsed.data.message,
      actor: actorOf(context.get('principal')),
      signal: context.req.raw.signal,
    });
  });
}
