/**
 * The landing page's motion: charts that draw themselves when they scroll into view, and the
 * hero's product flow, played once. The markup holds every final state, so without JavaScript or
 * under reduced motion the page shows them still. The head script sets `data-motion="on"` only
 * when motion is allowed.
 */

/**
 * Whether the page may animate.
 *
 * @returns `true` when the head script found no reduced-motion preference.
 */
function motionAllowed(): boolean {
  return document.documentElement.dataset.motion === 'on';
}

/**
 * Draws each `[data-draw]` chart the first time it scrolls into view.
 *
 * @param charts - The charts.
 */
export function drawOnView(charts: Iterable<Element>): void {
  const all = [...charts];
  if (!motionAllowed() || !('IntersectionObserver' in window)) {
    for (const chart of all) chart.classList.add('is-drawn');
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-drawn');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.35 },
  );
  for (const chart of all) observer.observe(chart);
}

/**
 * Waits.
 *
 * @param milliseconds - How long.
 * @returns A promise that settles then.
 */
function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Splits an element's text into words, all hidden, ready to stream in. Every word keeps its place
 * while hidden, so the text never moves the layout.
 *
 * @param element - The element.
 * @returns The words, in order.
 */
function hideWords(element: HTMLElement): HTMLElement[] {
  const tokens = (element.textContent ?? '').split(/(\s+)/).map((word) => {
    const token = document.createElement('span');
    token.className = 'token';
    token.textContent = word;
    return token;
  });
  element.replaceChildren(...tokens);
  element.classList.add('is-streaming');
  return tokens;
}

/**
 * Streams hidden words in, one after another, behind a caret.
 *
 * @param element - The element holding the words.
 * @param tokens - The words, from `hideWords`.
 */
async function streamWords(element: HTMLElement, tokens: readonly HTMLElement[]): Promise<void> {
  for (const [index, token] of tokens.entries()) {
    token.classList.add('is-on', 'caret');
    tokens[index - 1]?.classList.remove('caret');
    await pause(token.textContent?.trim() === '' ? 0 : 75);
  }
  element.classList.remove('is-streaming');
}

/**
 * Plays the product flow once: the question streams in, the plan's queries tick off, and the
 * chart draws.
 *
 * @param root - The flow's root, holding `[data-step]` elements in order.
 */
export async function playFlow(root: HTMLElement): Promise<void> {
  if (!motionAllowed()) return;
  const question = root.querySelector<HTMLElement>('[data-stream]');
  // The words are hidden before the flow shows the question, so its full text never flashes.
  const words = question ? hideWords(question) : [];
  root.classList.add('is-playing');
  await pause(400);
  if (question) await streamWords(question, words);
  for (const step of root.querySelectorAll<HTMLElement>('[data-step]')) {
    await pause(Number(step.dataset.step) || 450);
    step.classList.add('is-shown');
  }
  root.classList.add('is-done');
}
