/** Signing in and out, and setting or changing a password. */
import { z } from 'zod';
import { principalSchema } from '../roles.ts';
import { defineEndpoint } from './contract.ts';

/** The longest password accepted, in characters. */
const passwordField = z.string().min(1).max(256);

/** Signs in with an email and a password, and sets the session cookie. */
export const signInEndpoint = defineEndpoint({
  method: 'POST',
  path: '/auth/sign-in',
  body: z.object({ email: z.string().min(1).max(320), password: passwordField }),
  output: z.object({ principal: principalSchema }),
});

/** Ends the session the request carries, and clears its cookie. A POST, so no link can do it. */
export const signOutEndpoint = defineEndpoint({
  method: 'POST',
  path: '/auth/sign-out',
  output: z.object({ signedOut: z.literal(true) }),
});

/**
 * Sets a password with the token of an invite or reset link, ends the person's other sessions,
 * and signs them in.
 */
export const setPasswordEndpoint = defineEndpoint({
  method: 'POST',
  path: '/auth/set-password',
  body: z.object({ token: z.string().min(1).max(100), password: passwordField }),
  output: z.object({ principal: principalSchema }),
});

/** Changes the signed-in person's password, ends all their sessions, and starts a new one. */
export const changePasswordEndpoint = defineEndpoint({
  method: 'POST',
  path: '/auth/change-password',
  body: z.object({ current: passwordField, password: passwordField }),
  output: z.object({ changed: z.literal(true) }),
});
