/**
 * Putting a panel's mention in the composer, so the next turn is about that panel: from the
 * inspector's Ask about this panel.
 */
import type { Dispatch, SetStateAction } from 'react';

/** The id of the composer's text box, which a mention focuses. */
export const composerInputId = 'thread-message';

/**
 * The composer's text with a panel's mention at its start, once.
 *
 * @param draft - The text being written.
 * @param title - The panel's title.
 * @returns The text, starting with `@Title`.
 */
export function withMention(draft: string, title: string): string {
  const mention = `@${title}`;
  if (draft.includes(mention)) return draft;
  return `${mention} ${draft.trimStart()}`;
}

/**
 * The function that mentions a panel in the composer and puts the cursor at the end.
 *
 * @param setDraft - Sets the composer's text.
 * @param panels - The panels of the version shown.
 * @returns Mentions the panel with that id; nothing for an unknown id.
 */
function useMentionPanel(
  setDraft: Dispatch<SetStateAction<string>>,
  panels: readonly { readonly id: string; readonly title: string }[],
) {
  return (panelId: string) => {
    const panel = panels.find((each) => each.id === panelId);
    if (!panel) return;
    setDraft((current) => withMention(current, panel.title));
    requestAnimationFrame(() => {
      const input = document.getElementById(composerInputId) as HTMLTextAreaElement | null;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  };
}

/**
 * Mentions of the version's panels in the composer: the function the inspector calls.
 *
 * @param setDraft - Sets the composer's text.
 * @param panels - The panels of the version shown, once it is loaded.
 * @returns Mentions a panel by id.
 */
export function usePanelMentions(
  setDraft: Dispatch<SetStateAction<string>>,
  panels: readonly { readonly id: string; readonly title: string }[] | undefined,
) {
  return useMentionPanel(setDraft, panels ?? []);
}
