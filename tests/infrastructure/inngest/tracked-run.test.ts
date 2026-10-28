import { NonRetriableError } from "inngest";
import { describe, expect, it } from "vitest";
import { DuplicateExpenseNaturalKeyError } from "@/application/errors/duplicate-expense-natural-key-error";
import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";

describe("tracked Inngest crawler errors", () => {
  it("marks duplicate natural-key failures as non-retriable", async () => {
    let recordedFailure: string | undefined;
    const repository: CrawlerRunRepository = {
      start: async () => {},
      complete: async () => {},
      fail: async (_functionId, _runId, error) => {
        recordedFailure = error;
      },
    };

    await expect(
      runTrackedCrawler(
        repository,
        "backfill-despesas-month",
        {
          runId: "run-1",
          attempt: 0,
          eventName: "camara/despesas.backfill.month",
        },
        async () => {
          throw new DuplicateExpenseNaturalKeyError("[key]");
        },
      ),
    ).rejects.toBeInstanceOf(NonRetriableError);
    expect(recordedFailure).toContain("mesma chave natural");
  });
});
