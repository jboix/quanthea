/** Which edge a floating card lines up with, flipped when the asked edge pushes it off screen. */
import { type RefObject, useLayoutEffect, useRef, useState } from 'react';

/** Which edge of its button a card lines up with. */
type Align = 'start' | 'end';

/** The horizontal room a card has: from the rail's right edge to the viewport's. */
interface Room {
  readonly left: number;
  readonly right: number;
}

/**
 * The edge a card should line up with, so it stays in the room it has.
 *
 * @param asked - The edge asked for.
 * @param card - The card's left and right edges, laid out on the asked edge.
 * @param room - The room it has.
 * @returns The asked edge, or the other one when the card crosses the room's edge on its side
 *   and lining up the other way keeps it in.
 */
export function fittedAlign(asked: Align, card: Room, room: Room): Align {
  const width = card.right - card.left;
  if (asked === 'end' && card.left < room.left) return 'start';
  if (asked === 'start' && card.right > room.right && card.right - 2 * width >= room.left)
    return 'end';
  return asked;
}

/**
 * The room a card has: the viewport, less the navigation rail, which stays over the content.
 *
 * @returns The room.
 */
function roomOnScreen(): Room {
  const rail = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--rail-width'),
  );
  return { left: Number.isNaN(rail) ? 0 : rail, right: document.documentElement.clientWidth };
}

/**
 * The edge an open card lines up with: the asked one, flipped once laid out when it would run off
 * screen or under the rail.
 *
 * @param open - Whether the card is open.
 * @param asked - The edge asked for.
 * @returns A ref for the card, and the edge to use.
 */
export function useFittedAlign(
  open: boolean,
  asked: Align,
): [RefObject<HTMLDivElement | null>, Align] {
  const card = useRef<HTMLDivElement>(null);
  const [align, setAlign] = useState(asked);
  useLayoutEffect(() => {
    if (!open) {
      setAlign(asked);
      return;
    }
    if (!card.current) return;
    const { left, right } = card.current.getBoundingClientRect();
    if (align === asked) setAlign(fittedAlign(asked, { left, right }, roomOnScreen()));
  }, [open, asked, align]);
  return [card, open ? align : asked];
}
