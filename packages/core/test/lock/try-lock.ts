// Child helper: tries to take the workspace lock in another process and prints the outcome.
import { acquireLock } from '../../src/lock/index.ts';

const r = acquireLock(process.argv[2]!);
console.log(r.ok ? 'acquired' : r.error.code);
