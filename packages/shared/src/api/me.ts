/** `GET /api/me`: who the request acts as. Public. */
import { z } from 'zod';
import { principalSchema } from '../roles.ts';
import { defineEndpoint } from './contract.ts';

/** Returns the principal of the request and the active authentication mode. */
export const meEndpoint = defineEndpoint({
  method: 'GET',
  path: '/me',
  output: z.object({
    principal: principalSchema,
  }),
});
