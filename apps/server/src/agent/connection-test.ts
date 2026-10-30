/**
 * Tests the model gateway: reachability, tool calling and structured output, with the saved
 * settings and one short request for each.
 */
import type { modelTestSchema } from '@quanthea/shared';
import { APICallError, generateText, type LanguageModel, Output, tool } from 'ai';
import { z } from 'zod';
import type { ResolvedModelSettings } from '../settings/model-settings.ts';
import { clientCredentialsOf, modelTokens, type TokenSource } from '../settings/model-token.ts';
import { languageModel, modelIdFor, reasoningOption } from './model.ts';
import { providerMessage } from './public-error.ts';

/** The result of a test. */
type ModelTest = z.output<typeof modelTestSchema>;

/** The token step of a test. */
type TokenStep = NonNullable<ModelTest['token']>;

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
 * Describes a failure for the admin, without anything but the provider's own words. A gateway that
 * refuses a token gets a hint on what to check.
 *
 * @param error - What the test threw.
 * @param token - The token step, for a provider reached through an identity provider.
 * @returns The message.
 */
function describeFailure(error: unknown, token: TokenStep | undefined): string {
  const text = error instanceof Error ? error.message : String(error);
  const detail = providerMessage(error);
  const said = detail && !text.includes(detail) ? ` The provider says: ${detail}` : '';
  const refused =
    token && APICallError.isInstance(error) && [401, 403].includes(error.statusCode ?? 0);
  const hint = refused ? ' The gateway refused the token: check the scope and the audience.' : '';
  return `Not reachable: ${text.slice(0, 300)}${said}${hint}`;
}

/**
 * Gets a token, for a provider reached through an identity provider.
 *
 * @param resolved - The settings and the opened client secret.
 * @param tokens - The token source.
 * @returns The token step, or `undefined` for a provider reached with a key.
 */
async function tokenStep(
  resolved: ResolvedModelSettings,
  tokens: TokenSource,
): Promise<TokenStep | undefined> {
  if (resolved.auth?.type !== 'oauth-client-credentials') return undefined;
  const failed = { ok: false, issuerHost: null, expiresInSeconds: null };
  const credentials = clientCredentialsOf(resolved.auth, resolved.apiKey);
  if (credentials === null) return { ...failed, message: 'Save the client secret first.' };
  try {
    const issued = await tokens.token(credentials);
    const expiresInSeconds = Math.max(0, Math.round((issued.expiresAt - Date.now()) / 1000));
    return { ok: true, issuerHost: issued.issuerHost, expiresInSeconds, message: '' };
  } catch (error) {
    return { ...failed, message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Asks the model for a tool call and a structured answer.
 *
 * @param model - The model.
 * @param resolved - The settings.
 * @param elapsed - The time since the test started.
 * @returns The result.
 */
async function modelStep(
  model: LanguageModel,
  resolved: ResolvedModelSettings,
  elapsed: () => number,
): Promise<ModelTest> {
  const reasoning = reasoningOption(resolved.settings);
  const toolCalling = await callsTools(model, reasoning);
  const latencyMs = elapsed();
  const structuredOutput = await answersStructured(model, reasoning);
  const message = modelIdFor(resolved.settings, 'build');
  return { ok: true, latencyMs, toolCalling, structuredOutput, message };
}

/**
 * Tests the saved settings: the token first, for a provider reached through an identity provider,
 * then the model.
 *
 * @param resolved - The settings and the opened key or client secret.
 * @param build - Builds the model; the real providers by default.
 * @param tokens - The token source; the server's own by default.
 * @returns Whether the gateway answered, and what it supports.
 */
export async function testModelConnection(
  resolved: ResolvedModelSettings,
  build: typeof languageModel = languageModel,
  tokens: TokenSource = modelTokens,
): Promise<ModelTest> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const failed = { ok: false, toolCalling: false, structuredOutput: false };
  const token = await tokenStep(resolved, tokens);
  const withToken = token ? { token } : {};
  if (token && !token.ok) return { ...failed, latencyMs: elapsed(), message: token.message, token };
  try {
    const result = await modelStep(build(resolved, 'build', tokens), resolved, elapsed);
    return { ...result, ...withToken };
  } catch (error) {
    const message = describeFailure(error, token);
    return { ...failed, latencyMs: elapsed(), message, ...withToken };
  }
}
