// Child helper: takes the workspace lock, announces it, and holds it until killed.
import { acquireLock } from '../../src/lock/index.ts';

const r = acquireLock(process.argv[2]!);
console.log(r.ok ? 'held' : r.error.code);
setInterval(() => undefined, 1000);
