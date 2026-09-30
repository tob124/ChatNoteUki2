export type SyncKind = "backup" | "full" | "restore";

/** One serial queue for manual requests, debounce uploads and periodic inbox reads. */
export class AutoSync {
  private enabled = false;
  private interval = 60000;
  private failures = 0;
  private periodic: ReturnType<typeof setTimeout> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopped = false;
  private queue: {
    kind: SyncKind;
    waiters: { resolve(): void; reject(error: unknown): void }[];
  }[] = [];
  constructor(private execute: (kind: SyncKind) => Promise<void>) {}

  configure(enabled: boolean, interval: number) {
    this.enabled = enabled;
    this.interval = interval;
    this.failures = 0;
    this.clearTimers();
    if (enabled) this.schedule();
  }
  changed() {
    if (!this.enabled || this.stopped) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(
      () => {
        this.debounce = null;
        void this.run("backup").catch(() => {});
      },
      this.failures
        ? Math.min(this.interval * 2 ** this.failures, 15 * 60000)
        : 3000,
    );
  }
  run(kind: SyncKind): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("应用正在退出"));
    if (kind !== "backup") {
      if (this.periodic) clearTimeout(this.periodic);
      this.periodic = null;
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = null;
    }
    const result = new Promise<void>((resolve, reject) => {
      const last = this.queue.at(-1);
      if (last && last.kind !== "restore" && kind !== "restore") {
        last.kind = last.kind === "full" || kind === "full" ? "full" : "backup";
        last.waiters.push({ resolve, reject });
      } else this.queue.push({ kind, waiters: [{ resolve, reject }] });
    });
    void this.drain();
    return result;
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) {
        const { kind, waiters } = this.queue.shift()!;
        try {
          await this.execute(kind);
          if (this.failures && this.periodic) {
            clearTimeout(this.periodic);
            this.periodic = null;
          }
          this.failures = 0;
          waiters.forEach((w) => w.resolve());
        } catch (error) {
          this.failures = Math.min(this.failures + 1, 10);
          waiters.forEach((w) => w.reject(error));
        }
      }
    } finally {
      this.running = false;
      this.schedule();
    }
  }
  private schedule() {
    if (this.periodic && !this.failures) return;
    if (this.periodic) clearTimeout(this.periodic);
    this.periodic = null;
    if (!this.enabled || this.stopped || this.running) return;
    const delay = Math.min(this.interval * 2 ** this.failures, 15 * 60000);
    this.periodic = setTimeout(() => {
      this.periodic = null;
      void this.run("full").catch(() => {});
    }, delay);
  }
  private clearTimers() {
    if (this.periodic) clearTimeout(this.periodic);
    if (this.debounce) clearTimeout(this.debounce);
    this.periodic = null;
    this.debounce = null;
  }
  stop() {
    this.stopped = true;
    this.clearTimers();
    this.queue
      .splice(0)
      .forEach((request) =>
        request.waiters.forEach((w) => w.reject(new Error("应用正在退出"))),
      );
  }
}
