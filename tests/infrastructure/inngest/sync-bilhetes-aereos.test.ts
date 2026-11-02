import { describe, expect, it, vi } from "vitest";
import { createSyncBilhetesAereosFunction } from "@/infrastructure/inngest/functions/sync-bilhetes-aereos.function";
import { inngest } from "@/infrastructure/inngest/client";
import { parseBilheteSyncOptions } from "@/cli/bilhetes";

describe("ticket reconciliation sync", () => {
  it("runs a requested year with tracked removal counters", async () => {
    const capture = vi.spyOn(inngest, "createFunction");
    const reconcile = vi.fn(async () => ({
      enriched: 2,
      ambiguous: 1,
      removed: 3,
    }));
    const runs = {
      start: vi.fn(async () => {}),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
    };
    createSyncBilhetesAereosFunction({ reconcile }, runs);
    const [config, handler] = capture.mock.calls[0]!;
    expect(config).toMatchObject({
      id: "sync-bilhetes-aereos",
      retries: 5,
      triggers: [
        { event: "camara/bilhetes-aereos.sync" },
        { cron: "TZ=America/Sao_Paulo 0 4 * * 0" },
      ],
    });
    const summary = await handler({
      runId: "fixture",
      attempt: 0,
      event: { name: "camara/bilhetes-aereos.sync", data: { ano: 2025 } },
      step: {
        run: async (_id: string, execute: () => Promise<unknown>) => execute(),
      },
    } as Parameters<typeof handler>[0]);
    expect(reconcile).toHaveBeenCalledWith(2025);
    expect(summary).toEqual({
      years: 1,
      enriched: 2,
      ambiguous: 1,
      removed: 3,
    });
    expect(runs.complete).toHaveBeenCalledWith(
      "sync-bilhetes-aereos",
      "fixture",
      summary,
    );
    capture.mockRestore();
  });

  it("requires an explicit local write flag and validates the year", () => {
    expect(parseBilheteSyncOptions(["--ano=2025", "--persist"])).toEqual([
      2025,
    ]);
    expect(
      parseBilheteSyncOptions(["--ano=2025", "--import", "--persist"]),
    ).toEqual([2025]);
    expect(() => parseBilheteSyncOptions(["--ano=2025", "--import"])).toThrow(
      "--persist",
    );
    expect(() => parseBilheteSyncOptions(["--ano=2025"])).toThrow("--persist");
    expect(() => parseBilheteSyncOptions(["--ano=2007", "--persist"])).toThrow(
      "2008",
    );
    expect(() => parseBilheteSyncOptions(["--ano=no", "--persist"])).toThrow();
    expect(() =>
      parseBilheteSyncOptions(["--ano=2024", "--ano=2025", "--persist"]),
    ).toThrow("apenas uma vez");
  });
});
