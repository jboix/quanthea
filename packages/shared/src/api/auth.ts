/** Signing in and out. */
import { z } from 'zod';
import { defineEndpoint } from './contract.ts';

/** Ends the session the request carries, and clears its cookie. A POST, so no link can do it. */
export const signOutEndpoint = defineEndpoint({
  method: 'POST',
  path: '/auth/sign-out',
  output: z.object({ signedOut: z.literal(true) }),
});
