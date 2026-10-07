/**
 * Following the end of a growing conversation as a chat does: while the person is at the end, new
 * content keeps it in view; once they scroll up to read, it stays where they are, and counts what
 * arrives below. Sending, or opening another conversation, goes to the end again.
 */
import { type RefObject, type UIEvent, useEffect, useRef, useState } from 'react';

/** How close to the end, in pixels, still counts as at the end. */
const nearEnd = 48;

/** What the conversation knows about its end. */
export interface FollowEnd<Element extends HTMLElement> {
  /** The scrolling element's ref. */
  readonly ref: RefObject<Element | null>;
  /** Its scroll handler, which notes whether the person is at the end. */
  readonly onScroll: (event: UIEvent<Element>) => void;
  /**
   * What arrived below while the person read further up: how many new items, 0 when only the
   * latest one grew, or `null` when nothing did.
   */
  readonly unseen: number | null;
  /** Goes to the end, and follows it again. */
  readonly jump: () => void;
}

/** What the conversation is, to follow its end. */
export interface FollowedContent {
  /** Changes whenever the content grows, such as a count and a length. */
  readonly growth: string;
  /** How many items it has, such as messages, to count the new ones. */
  readonly count: number;
  /**
   * Changes when the end must come into view whatever the person was reading: they sent a
   * message, or another conversation opened.
   */
  readonly restart: string;
  /** Whether to leave the scroll alone, such as while a question found by a search is shown. */
  readonly paused?: boolean;
}

/** Where the person is, kept between renders. */
interface Position {
  /** Whether they are at the end. */
  following: boolean;
  /** The restart seen last. */
  restart: string;
  /** How many items there were when they left the end. */
  countWhenLeft: number;
}

/**
 * Goes to the end as the content grows while the person is there, and otherwise counts what is
 * new below.
 *
 * @param ref - The scrolling element.
 * @param position - Where the person is.
 * @param content - The content followed.
 * @param setUnseen - Sets what is unseen.
 */
function useScrollOnGrowth(
  ref: RefObject<HTMLElement | null>,
  position: RefObject<Position>,
  content: FollowedContent,
  setUnseen: (unseen: number | null) => void,
): void {
  const { growth, count, restart, paused = false } = content;
  useEffect(() => {
    const element = ref.current;
    const at = position.current;
    if (!element || paused || growth === '') return;
    if (at.restart !== restart) {
      at.restart = restart;
      at.following = true;
    }
    if (!at.following) return setUnseen(Math.max(0, count - at.countWhenLeft));
    element.scrollTop = element.scrollHeight;
    setUnseen(null);
  }, [ref, position, growth, count, restart, paused, setUnseen]);
}

/**
 * Keeps the end of a scrolling element in view while the person is there, and counts what arrives
 * below while they are not.
 *
 * @param content - Its growth, its count of items, what restarts following, and whether paused.
 * @returns The ref and scroll handler for the element, what is unseen, and the way to the end.
 */
export function useFollowEnd<Element extends HTMLElement>(
  content: FollowedContent,
): FollowEnd<Element> {
  const ref = useRef<Element>(null);
  const position = useRef<Position>({
    following: true,
    restart: content.restart,
    countWhenLeft: content.count,
  });
  const [unseen, setUnseen] = useState<number | null>(null);
  useScrollOnGrowth(ref, position, content, setUnseen);
  const onScroll = (event: UIEvent<Element>) => {
    const element = event.currentTarget;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= nearEnd;
    const at = position.current;
    if (atEnd === at.following) return;
    at.following = atEnd;
    at.countWhenLeft = content.count;
    if (atEnd) setUnseen(null);
  };
  const jump = () => {
    position.current.following = true;
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    setUnseen(null);
  };
  return { ref, onScroll, unseen, jump };
}
