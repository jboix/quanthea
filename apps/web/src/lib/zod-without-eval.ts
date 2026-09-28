/**
 * Turns off Zod's JIT, which probes `new Function`. The CSP forbids it, and the browser reports
 * the probe as a violation. Zod reads the flag when a schema is built, so `main.tsx` imports this
 * module before anything that builds one.
 */
import { z } from 'zod';

z.config({ jitless: true });
