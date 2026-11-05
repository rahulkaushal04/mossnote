/** Auto-backup scheduling (PT-7): daily by default, first run delayed, one run at a time, clock-skew safe. */
export interface ScheduleSettings {
  auto: boolean;
  intervalHours: number;
  keep: number;
}
export const DEFAULT_SCHEDULE: ScheduleSettings = { auto: true, intervalHours: 24, keep: 7 };

export interface SchedulerDeps {
  now(): number;
  /** Injectable for fake-clock tests. */
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  settings(): ScheduleSettings;
  lastAutoAt(): number;
  /** Runs one automatic backup (and prune). Must resolve with ok:false instead of throwing. */
  run(): Promise<{ ok: boolean; message?: string }>;
  onWarn?(message: string): void;
  startDelayMs?: number;
  checkEveryMs?: number;
}

export function createBackupScheduler(d: SchedulerDeps) {
  const HOUR = 3_600_000;
  let timer: unknown;
  let running: Promise<void> | undefined;
  let stopped = true;

  const due = (): boolean => {
    const s = d.settings();
    if (!s.auto) return false;
    const last = d.lastAutoAt();
    const now = d.now();
    return last === 0 || last > now || now - last >= s.intervalHours * HOUR; // a future stamp (clock skew) counts as due
  };
  const arm = (ms: number): void => {
    if (stopped) return;
    timer = d.setTimer(() => void tick(), ms);
  };
  async function tick(): Promise<void> {
    if (stopped) return;
    if (!running && due()) {
      running = d
        .run()
        .then((r) => {
          if (!r.ok) d.onWarn?.(r.message ?? 'The automatic backup failed.');
        })
        .catch(() => d.onWarn?.('The automatic backup failed.'))
        .finally(() => {
          running = undefined;
        });
    }
    await running;
    arm(d.checkEveryMs ?? HOUR);
  }
  return {
    /** First check after 10 minutes (the app is busy at launch), then hourly. */
    start(): void {
      if (!stopped) return;
      stopped = false;
      arm(d.startDelayMs ?? 10 * 60_000);
    },
    /** Runs the due-check now (tests, and "settings changed"). */
    tick,
    /** Stops timers; resolves when a running backup has finished (quit drain). */
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== undefined) d.clearTimer(timer);
      timer = undefined;
      await running;
    },
    get running(): boolean {
      return running !== undefined;
    },
  };
}
export type BackupScheduler = ReturnType<typeof createBackupScheduler>;
