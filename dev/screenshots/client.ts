/**
 * A small client of the screenshot instance's API: signs a person in, sends JSON, reads a stream
 * to its end, and talks to the agent in a thread the way the web app does, approving each plan and
 * answering each question with the first option.
 */

/** The instance's address. */
export const baseUrl = process.env.QUANTHEA_SHOTS_URL ?? 'http://localhost:3990';

/** The time zone the people of the instance live in. */
export const timeZone = 'Europe/Zurich';

/**
 * Writes a line of progress, with the time, so a long run shows what it is doing.
 *
 * @param text - What happens.
 */
export function progress(text: string): void {
  const time = new Date().toLocaleTimeString('en-GB', { timeZone, hour12: false });
  process.stdout.write(`${time}  ${text}\n`);
}

/**
 * A request, cut to one short line for the progress.
 *
 * @param text - The request.
 * @returns Its first words.
 */
export function shortened(text: string): string {
  return text.length > 70 ? `${text.slice(0, 69)}…` : text;
}

/** Calls the API as one signed-in person. */
export type Api = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

/** The parts of a thread the driver reads. */
interface ThreadView {
  readonly state: string;
  readonly dashboardId: string | null;
  readonly alertId: string | null;
  readonly reportId: string | null;
  readonly plans: readonly { id: string; status: string }[];
  readonly messages: readonly {
    id: string;
    role: string;
    parts: readonly { type: string; input?: { options?: readonly string[] } }[];
  }[];
}

/**
 * Signs a person in.
 *
 * @param email - Their email.
 * @param password - Their password.
 * @returns The session cookie.
 */
async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Signing in ${email}: ${response.status}`);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

/**
 * A client for one person.
 *
 * @param email - Their email.
 * @param password - Their password.
 * @returns The client, and their session cookie for the browser.
 */
export async function personClient(email: string, password: string) {
  const cookie = await signIn(email, password);
  const api: Api = async (method, path, body) => {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea', cookie },
      body: body === undefined ? null : JSON.stringify(body),
      // A build waits out the provider's rate limits, which can take minutes.
      signal: AbortSignal.timeout(1_200_000),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 300)}`);
    return (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as never;
  };
  return { api, cookie };
}

/**
 * A message from the person.
 *
 * @param text - What they say.
 * @returns The message.
 */
function said(text: string) {
  const parts = [{ type: 'text', text }];
  return { id: crypto.randomUUID(), role: 'user', parts, metadata: { mentions: [], timeZone } };
}

/**
 * What to send next in a thread: the continuation after approving its plan or after a build that
 * stopped, the answer to the agent's question, or nothing once it is built or waiting on nothing.
 *
 * @param api - The person's client.
 * @param threadId - The thread.
 * @param retries - How many times the thread's build was tried again; one is the most.
 * @returns The next message, if any.
 */
async function nextMessage(
  api: Api,
  threadId: string,
  retries: { count: number },
): Promise<unknown> {
  const thread = await api<ThreadView>('GET', `/threads/${threadId}`);
  const last = thread.messages.at(-1);
  if (last?.role !== 'assistant') return undefined;
  const plan = thread.plans.at(-1);
  if (thread.state === 'plan_pending' && plan?.status === 'pending') {
    progress('    the agent proposed a plan: approving it');
    await api('POST', `/threads/${threadId}/plans/${plan.id}/approve`, {});
    return { id: last.id, role: 'assistant', parts: [] };
  }
  // A build stopped short, by a rate limit or after failed repairs: wait, and try again once.
  if (thread.state === 'building') {
    if (retries.count >= 1) return undefined;
    retries.count += 1;
    progress('    the build stopped short: trying again in 45 s');
    await Bun.sleep(45_000);
    return { id: last.id, role: 'assistant', parts: [] };
  }
  return replyTo(thread);
}

/**
 * Writes the error a turn ended with, if its stream carries one, such as a wrong API key or a
 * spent quota.
 *
 * @param stream - The chat's stream, as text.
 */
function reportFailure(stream: unknown): void {
  if (typeof stream !== 'string') return;
  const failure = /"type":"error","errorText":"((?:[^"\\]|\\.)*)"/.exec(stream)?.[1];
  if (failure) progress(`    the turn failed: ${shortened(JSON.parse(`"${failure}"`))}`);
}

/**
 * The person's reply to an answer that waits on them: the first option of the agent's question,
 * or a go-ahead when the thread is idle.
 *
 * @param thread - The thread, its latest message the agent's.
 * @returns The reply, or nothing when the thread waits on no one.
 */
function replyTo(thread: ThreadView): unknown {
  const last = thread.messages.at(-1);
  const asked = last?.parts.find((part) => part.type === 'tool-ask_person')?.input;
  if (asked) {
    progress('    the agent asked a question: answering with its first option');
    return said(asked.options?.[0] ?? 'Your pick.');
  }
  if (thread.state !== 'idle') return undefined;
  progress('    the agent waits: telling it to go ahead');
  return said('Go ahead with what you think fits.');
}

/**
 * Starts a thread and talks to the agent until it proposes a plan, which it leaves waiting.
 *
 * @param api - The person's client.
 * @param text - What the person asks.
 * @returns The thread's id.
 */
export async function untilPlan(api: Api, text: string): Promise<string> {
  const { id } = await api<{ id: string }>('POST', '/threads', { kind: 'dashboard' });
  let message: unknown = said(text);
  for (let turn = 0; message !== undefined && turn < 6; turn += 1) {
    reportFailure(await api<string>('POST', `/threads/${id}/chat`, { message }));
    const thread = await api<ThreadView>('GET', `/threads/${id}`);
    if (thread.state === 'plan_pending') {
      progress('    the agent proposed a plan: leaving it waiting');
      return id;
    }
    message = replyTo(thread);
  }
  throw new Error(`No plan came of "${text}".`);
}

/**
 * Talks to the agent until the thread is built or waits on nothing, at most eight runs.
 *
 * @param api - The person's client.
 * @param threadId - The thread.
 * @param text - What the person asks first.
 * @returns The thread as it ends.
 */
export async function converse(api: Api, threadId: string, text: string): Promise<ThreadView> {
  let message: unknown = said(text);
  const retries = { count: 0 };
  for (let turn = 0; message !== undefined && turn < 8; turn += 1) {
    progress(`    turn ${turn + 1}: the agent is working`);
    reportFailure(await api<string>('POST', `/threads/${threadId}/chat`, { message }));
    message = await nextMessage(api, threadId, retries);
  }
  return api<ThreadView>('GET', `/threads/${threadId}`);
}

/** What a thread makes. */
type ThreadKind = 'dashboard' | 'alert' | 'report';

/**
 * Whether a thread made what it was asked for and is ready.
 *
 * @param thread - The thread as it ended.
 * @param kind - What it makes.
 * @returns Whether it is built.
 */
function built(thread: ThreadView, kind: ThreadKind): boolean {
  const made = { dashboard: thread.dashboardId, alert: thread.alertId, report: thread.reportId };
  return thread.state === 'ready' && made[kind] !== null;
}

/**
 * Starts a thread and talks it to the end. A thread whose build keeps failing goes to the bin,
 * and the request starts over once in a new thread, which costs less than repairing the old one.
 *
 * @param api - The person's client.
 * @param kind - What the thread makes.
 * @param text - What the person asks.
 * @returns The thread as it ends.
 */
export async function build(
  api: Api,
  kind: ThreadKind,
  text: string,
): Promise<ThreadView & { id: string }> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { id } = await api<{ id: string }>('POST', '/threads', { kind });
    const thread = { ...(await converse(api, id, text)), id };
    if (built(thread, kind)) return thread;
    progress('    nothing usable came of this thread: binning it and starting over');
    await api('DELETE', `/threads/${id}`);
  }
  throw new Error(`Nothing came of "${shortened(text)}" in two threads. Run the script again.`);
}
