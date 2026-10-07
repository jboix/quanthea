/**
 * A fixed number of slots for costly work, such as argon2id checks. A caller takes a slot or is
 * refused at once; nothing queues, so a burst cannot pile up work behind the slots.
 */

/** The most argon2id checks at once: 8, so a burst of sign-ins cannot hold the CPU and memory. */
export const maximumVerifications = 8;

/** Slots for costly work. */
export interface Slots {
  /**
   * Takes a slot when one is free.
   *
   * @returns A function that gives the slot back, or `undefined` when every slot is taken.
   */
  take(): (() => void) | undefined;
}

/**
 * Creates slots.
 *
 * @param size - How many slots there are.
 * @returns The slots.
 */
export function createSlots(size: number): Slots {
  let taken = 0;
  return {
    take: () => {
      if (taken >= size) return undefined;
      taken += 1;
      let given = false;
      return () => {
        if (given) return;
        given = true;
        taken -= 1;
      };
    },
  };
}
