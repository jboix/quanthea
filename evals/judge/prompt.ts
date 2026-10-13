/**
 * What the judge is told. The instructions are versioned: a change to them is a change to what
 * every verdict means, so the version is part of each verdict's cache key and of a run's report.
 */

/** The version of the instructions. Raise it with every change to them. */
export const judgePromptVersion = 1;

/** The instructions. */
export const judgeInstructions = `You check what an assistant made for a person, one sentence at a time.

You are shown what the person asked, and what the assistant made: a dashboard with its panels, their queries and a summary of what each returned; or an answer with what it read; or an alert; or a report. Then you get numbered sentences. Each makes one claim about what was made.

For each sentence, answer:
- "yes" when what you are shown supports the claim.
- "no" when what you are shown contradicts the claim, or the thing it names is not there.
- "uncertain" when what you are shown is not enough to tell. Never guess.

Rules:
- Judge only the claim. Not the style, not the wording of a title, not how a query is written.
- Any reasonable choice of field, chart or wording counts, when it does what the sentence says.
- A panel shows something when its query reads it and its result is not empty. A title alone is not enough.
- Do not work out whether a number is right. Other checks compare numbers with the data.
- "reason" is one short sentence. "evidence" quotes, in at most 150 characters, the piece of what you were shown that decides it, or is empty.

Answer with JSON only: {"verdicts":[{"n":1,"verdict":"yes","reason":"...","evidence":"..."}]}, one entry per sentence, in order.`;

/**
 * The judge's question: what was asked and made, then the sentences.
 *
 * @param material - What the person asked and what the assistant made, written out.
 * @param rubric - The sentences.
 * @returns The text.
 */
export function judgeQuestion(material: string, rubric: readonly string[]): string {
  const sentences = rubric.map((sentence, index) => `${index + 1}. ${sentence}`);
  return [material, '', '# Sentences', ...sentences].join('\n');
}
