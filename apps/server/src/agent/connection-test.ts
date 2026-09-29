/**
 * Tests the model gateway: reachability, tool calling and structured output, with the saved
 * settings and one short request for each.
 */
import type { modelTestSchema } from '@querent/shared';
import { APICallError, generateText, type LanguageModel, Output, tool } from 'ai';
import { z } from 'zod';
import type { ResolvedModelSettings } from '../settings/model-settings.ts';
import { languageModel, modelIdFor, reasoningOption } from './model.ts';
import { providerMessage } from './public-error.ts';

/** The result of a test. */
type ModelTest = z.output<typeof modelTestSchema>;

/** The reasoning option of a call, as the agent's runs set it. */
type Reasoning = ReturnType<typeof reasoningOption>;

/** The longest one test request may take. */
const requestTimeoutMs = 20_000;

/**
 * Whether the model calls a tool when told to.
 *
 * @param model - The model.
 * @param reasoning - The reasoning option the agent's runs use.
 * @returns Whether it called `ping` with the value asked for.
 * @throws {APICallError} When the provider cannot be reached or refuses the request.
 */
async function callsTools(model: LanguageModel, reasoning: Reasoning): Promise<boolean> {
  try {
    const result = await generateText({
      ...reasoning,
      model,
      maxRetries: 0,
      timeout: requestTimeoutMs,
      prompt: 'Call the ping tool with the value 42.',
      tools: {
        ping: tool({
          description: 'Answers a ping.',
          inputSchema: z.object({ value: z.number() }),
        }),
      },
      toolChoice: { type: 'tool', toolName: 'ping' },
    });
    return result.toolCalls.some((call) => (call.input as { value?: unknown }).value === 42);
  } catch (error) {
    // The provider answered but not with the tool call: reachable, without tool calling.
    if (APICallError.isInstance(error) || !(error instanceof Error)) throw error;
    return false;
  }
}

/**
 * Whether the model answers in a given JSON shape.
 *
 * @param model - The model.
 * @param reasoning - The reasoning option the agent's runs use.
 * @returns Whether the answer parsed.
 */
async function answersStructured(model: LanguageModel, reasoning: Reasoning): Promise<boolean> {
  try {
    const result = await generateText({
      ...reasoning,
      model,
      maxRetries: 0,
      timeout: requestTimeoutMs,
      prompt: 'Answer with ok set to true.',
      output: Output.object({ schema: z.object({ ok: z.boolean() }) }),
    });
    return result.output.ok === true;
  } catch {
    return false;
  }
}

/**
 * Describes a failure for the admin, without anything but the provider's own words.
 *
 * @param error - What the test threw.
 * @returns The message.
 */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const detail = providerMessage(error);
  const said = detail && !text.includes(detail) ? ` The provider says: ${detail}` : '';
  return `Not reachable: ${text.slice(0, 300)}${said}`;
}

/**
 * Tests the saved settings.
 *
 * @param resolved - The settings and the opened key.
 * @param build - Builds the model; the real providers by default.
 * @returns Whether the gateway answered, and what it supports.
 */
export async function testModelConnection(
  resolved: ResolvedModelSettings,
  build: typeof languageModel = languageModel,
): Promise<ModelTest> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const model = build(resolved, 'build');
    const reasoning = reasoningOption(resolved.settings);
    const toolCalling = await callsTools(model, reasoning);
    const latencyMs = elapsed();
    const structuredOutput = await answersStructured(model, reasoning);
    const message = modelIdFor(resolved.settings, 'build');
    return { ok: true, latencyMs, toolCalling, structuredOutput, message };
  } catch (error) {
    return {
      ok: false,
      latencyMs: elapsed(),
      toolCalling: false,
      structuredOutput: false,
      message: describeFailure(error),
    };
  }
}
