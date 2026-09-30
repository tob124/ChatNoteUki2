import { afterEach, expect, it, vi } from "vitest";
import { AutoSync, type SyncKind } from "../../electron/auto-sync";
const instances: AutoSync[] = [];
function open(execute: ConstructorParameters<typeof AutoSync>[0]) {
  vi.useFakeTimers();
  const sync = new AutoSync(execute);
  instances.push(sync);
  return sync;
}
afterEach(() => {
  instances.splice(0).forEach((s) => s.stop());
  vi.useRealTimers();
});
it("debounces local changes and periodically imports phone input", async () => {
  const execute = vi.fn(async () => {});
  const sync = open(execute);
  sync.configure(true, 60000);
  sync.changed();
  await vi.advanceTimersByTimeAsync(2000);
  sync.changed();
  await vi.advanceTimersByTimeAsync(2999);
  expect(execute).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(execute.mock.calls).toEqual([["backup"]]);
  await vi.advanceTimersByTimeAsync(60000);
  expect(execute.mock.calls).toEqual([["backup"], ["full"]]);
});
it("continues checking inbox while frequent desktop changes are uploaded", async () => {
  const execute = vi.fn(async (_kind: SyncKind) => {});
  const sync = open(execute);
  sync.configure(true, 60000);
  for (let i = 0; i < 15; i++) {
    sync.changed();
    await vi.advanceTimersByTimeAsync(4000);
  }
  expect(execute.mock.calls.filter(([kind]) => kind === "full")).toHaveLength(
    1,
  );
});
it("serializes manual, automatic uploads and restore without losing pending changes", async () => {
  let finish!: () => void;
  const calls: string[] = [];
  const sync = open(async (kind) => {
    calls.push(kind);
    if (calls.length === 1)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  sync.configure(true, 60000);
  const first = sync.run("full");
  sync.changed();
  await vi.advanceTimersByTimeAsync(3000);
  const restore = sync.run("restore");
  const second = sync.run("full");
  expect(calls).toEqual(["full"]);
  finish();
  await Promise.all([first, restore, second]);
  expect(calls).toEqual(["full", "backup", "restore", "full"]);
});
it("backs off failed requests and resets the interval after recovery", async () => {
  const execute = vi
    .fn()
    .mockRejectedValueOnce(new Error("断网"))
    .mockRejectedValueOnce(new Error("断网"))
    .mockResolvedValue(undefined);
  const sync = open(execute);
  sync.configure(true, 60000);
  await vi.advanceTimersByTimeAsync(60000);
  expect(execute).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(119999);
  expect(execute).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(execute).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(240000);
  expect(execute).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(60000);
  expect(execute).toHaveBeenCalledTimes(4);
});
it("disables timers while preserving manual sync, and cancels work on exit", async () => {
  const execute = vi.fn(async () => {});
  const sync = open(execute);
  sync.configure(true, 60000);
  sync.changed();
  sync.configure(false, 60000);
  await vi.advanceTimersByTimeAsync(600000);
  expect(execute).not.toHaveBeenCalled();
  await sync.run("full");
  expect(execute).toHaveBeenCalledTimes(1);
  sync.stop();
  await expect(sync.run("full")).rejects.toThrow("退出");
  await vi.advanceTimersByTimeAsync(600000);
  expect(execute).toHaveBeenCalledTimes(1);
});
