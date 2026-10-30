/**
 * The connection test of a saved provider: the token step first for a provider reached through an
 * identity provider, then the model.
 */
import { type SubmitTarget, useFetcher } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { CheckIcon, WarningIcon } from '../../ui/icons.tsx';
import type { ModelSettingsIntent, ModelSettingsOutcome, ModelTest } from './data.ts';
import styles from './model-settings.module.css';

/**
 * Describes the model step.
 *
 * @param result - The result.
 * @returns Such as `Reachable · tool calling supported · structured output supported · 812 ms`.
 */
function modelLine(result: ModelTest): string {
  if (!result.ok) return result.message;
  const tools = result.toolCalling ? 'tool calling supported' : 'no tool calling';
  const structured = result.structuredOutput
    ? 'structured output supported'
    : 'no structured output';
  return `Reachable · ${tools} · ${structured} · ${Math.round(result.latencyMs)} ms`;
}

/**
 * Describes a result, one line per step.
 *
 * @param result - The result.
 * @returns The token line, if the provider has one, then the model line.
 */
function testLines(result: ModelTest): string[] {
  const { token } = result;
  if (token === undefined) return [modelLine(result)];
  if (!token.ok) return [`Token: ${token.message}`, 'Model: not tried.'];
  const minutes = Math.round((token.expiresInSeconds ?? 0) / 60);
  return [`Token from ${token.issuerHost} · valid ${minutes} min`, `Model: ${modelLine(result)}`];
}

/**
 * What the test shows.
 *
 * @param result - The last result, if any.
 * @param testing - Whether a test is running.
 * @param dirty - Whether the form has unsaved changes.
 * @returns The tone and the lines.
 */
function testState(result: ModelTest | undefined, testing: boolean, dirty: boolean) {
  if (testing) return { tone: 'idle', lines: ['Testing…'] };
  if (result)
    return { tone: result.ok && result.toolCalling ? 'ok' : 'failed', lines: testLines(result) };
  return { tone: 'idle', lines: [dirty ? 'Save to test these settings.' : 'Not tested yet.'] };
}

/**
 * The connection test: its last result and the button that runs it on the saved settings.
 *
 * @param props - Whether the form has unsaved changes, and the provider.
 * @param props.dirty - Whether the form differs from the saved settings.
 * @param props.providerId - The saved provider to test.
 * @returns The test.
 */
export function ConnectionTest({
  dirty,
  providerId,
}: {
  readonly dirty: boolean;
  readonly providerId: string;
}) {
  const fetcher = useFetcher<ModelSettingsOutcome>();
  const result = fetcher.data?.intent === 'test' ? fetcher.data.result : undefined;
  const testing = fetcher.state !== 'idle';
  const intent: ModelSettingsIntent = { intent: 'test', providerId };
  const run = () =>
    void fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  const { tone, lines } = testState(result, testing, dirty);
  return (
    <div className={styles.test} data-tone={tone} role="status">
      {tone === 'ok' && <CheckIcon />}
      {tone === 'failed' && <WarningIcon />}
      <span className={styles.testLines}>
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
      <Button size="small" onClick={run} disabled={testing || dirty}>
        {result ? 'Test again' : 'Test'}
      </Button>
    </div>
  );
}
