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

/**
 * Sets up the default admin's account at their first sign-in: their own email, name and password.
 * Until then, every other route refuses them.
 */
export const completeSetupEndpoint = defineEndpoint({
  method: 'POST',
  path: '/auth/setup',
  body: z.object({
    email: z.email().max(320),
    name: z.string().trim().min(1).max(100),
    password: passwordField,
  }),
  output: z.object({ principal: principalSchema }),
});

/** Ends the session the request carries, and clears its cookie. A POST, so no link can do it. */
export const signOutEndpoint = defineEndpoint({
  method: 'POST',
  path: '/auth/sign-out',
  output: z.object({ signedOut: z.literal(true) }),
});

/** Ends every session of the signed-in person, this one too, and clears the cookie. */
export const signOutEverywhereEndpoint = defineEndpoint({
  method: 'POST',
  path: '/auth/sign-out-everywhere',
  output: z.object({ ended: z.int() }),
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
