import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";
import { DrizzleCrawlerRunRepository } from "@/infrastructure/persistence/drizzle-crawler-run-repository";
import * as schema from "@/infrastructure/persistence/schema";

describe("Inngest crawler run records", () => {
  let database: PGlite;
  let repository: DrizzleCrawlerRunRepository;

  beforeEach(async () => {
    database = new PGlite();
    const migration: string = await readFile(
      new URL("../../../drizzle/0005_silent_raider.sql", import.meta.url),
      "utf8",
    );
    await database.exec(migration.replace(/--> statement-breakpoint/g, ""));
    repository = new DrizzleCrawlerRunRepository(drizzle(database, { schema }));
  });

  afterEach(async () => {
    await database.close();
  });

  it("records success summary and keeps a single row across Inngest retries", async () => {
    const context = {
      runId: "run-success",
      attempt: 0,
      eventName: "camara/legislaturas.seed",
    };

    await expect(
      runTrackedCrawler(repository, "sync-legislaturas", context, async () => ({
        pages: 4,
        fetched: 57,
      })),
    ).resolves.toEqual({ pages: 4, fetched: 57 });
    await repository.start({
      ...context,
      functionId: "sync-legislaturas",
      attempt: 2,
    });
    await repository.complete("sync-legislaturas", "run-success", {
      pages: 4,
      fetched: 57,
    });

    const rows = await database.query<{
      function_id: string;
      run_id: string;
      event_name: string;
      attempt: number;
      status: string;
      summary: { pages: number; fetched: number };
      error: string | null;
    }>(
      `SELECT function_id, run_id, event_name, attempt, status, summary, error
       FROM crawler_runs`,
    );
    expect(rows.rows).toEqual([
      {
        function_id: "sync-legislaturas",
        run_id: "run-success",
        event_name: "camara/legislaturas.seed",
        attempt: 2,
        status: "completed",
        summary: { pages: 4, fetched: 57 },
        error: null,
      },
    ]);
  });

  it("records failures before propagating them to Inngest", async () => {
    await expect(
      runTrackedCrawler(
        repository,
        "sync-despesas",
        {
          runId: "run-failure",
          attempt: 0,
          eventName: "inngest/scheduled.timer",
        },
        async () => {
          throw new Error("Falha na API");
        },
      ),
    ).rejects.toThrow("Falha na API");

    const rows = await database.query<{
      status: string;
      error: string | null;
      finished_at: string | null;
    }>(`SELECT status, error, finished_at::text FROM crawler_runs`);
    expect(rows.rows).toEqual([
      {
        status: "failed",
        error: "Falha na API",
        finished_at: expect.any(String),
      },
    ]);
  });
});
