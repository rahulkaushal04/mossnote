/**
 * Turn off zod's compiled fast path in the browser.
 *
 * zod normally probes whether `new Function` works, and under our Content-Security-Policy that
 * probe is reported as a violation even though the error is caught. Parsing without it is
 * slightly slower, which does not matter for the few small schemas the web app runs.
 *
 * Import this before any module that builds a zod schema, because the setting is read when a
 * schema is created.
 */
import { config } from 'zod';

config({ jitless: true });
