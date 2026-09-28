/**
 * The tool that asks the person one question with a few options to pick from. The run ends after
 * it, and the person's answer arrives as their next message.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { RunContext } from './run-context.ts';

/**
 * The ask tool of a run.
 *
 * @param context - The run.
 * @returns The tool.
 */
export function askPersonTool(context: RunContext) {
  return tool({
    description:
      'Ask the person one short question, with 2 to 4 options they can pick with a click (they can also type their own answer). Use it when the request could mean several things. The question shows as a card with the options as buttons, so do not also write it in your message. Your turn ends after it.',
    inputSchema: z.object({
      question: z.string().min(1).max(300),
      options: z.array(z.string().min(1).max(100)).min(2).max(4),
    }),
    execute: () => {
      context.counters.asked = true;
      return { asked: true, next: 'Stop here and wait for the answer.' };
    },
  });
}
