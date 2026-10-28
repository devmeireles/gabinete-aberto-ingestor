import { sql } from "drizzle-orm";
import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import type { Database } from "./client";
import { crawlerRuns } from "./schema";

export class DrizzleCrawlerRunRepository implements CrawlerRunRepository {
  constructor(private readonly db: Database) {}

  async start(input: {
    readonly functionId: string;
    readonly runId: string;
    readonly eventName: string;
    readonly attempt: number;
  }): Promise<void> {
    await this.db
      .insert(crawlerRuns)
      .values({
        ...input,
        status: "running",
        finishedAt: null,
        summary: null,
        error: null,
      })
      .onConflictDoUpdate({
        target: [crawlerRuns.functionId, crawlerRuns.runId],
        set: {
          eventName: sql`excluded.event_name`,
          attempt: sql`GREATEST(${crawlerRuns.attempt}, excluded.attempt)`,
          status: "running",
          finishedAt: null,
          summary: null,
          error: null,
        },
      });
  }

  async complete(
    functionId: string,
    runId: string,
    summary: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const updated = await this.db
      .update(crawlerRuns)
      .set({
        status: "completed",
        finishedAt: sql`now()`,
        summary: { ...summary },
        error: null,
      })
      .where(
        sql`${crawlerRuns.functionId} = ${functionId} AND ${crawlerRuns.runId} = ${runId}`,
      )
      .returning({ id: crawlerRuns.id });
    if (updated.length !== 1) {
      throw new Error(
        `Execução Inngest ${functionId}/${runId} não foi registrada antes da conclusão`,
      );
    }
  }

  async fail(functionId: string, runId: string, error: string): Promise<void> {
    const updated = await this.db
      .update(crawlerRuns)
      .set({
        status: "failed",
        finishedAt: sql`now()`,
        error,
      })
      .where(
        sql`${crawlerRuns.functionId} = ${functionId} AND ${crawlerRuns.runId} = ${runId}`,
      )
      .returning({ id: crawlerRuns.id });
    if (updated.length !== 1) {
      throw new Error(
        `Execução Inngest ${functionId}/${runId} não foi registrada antes da falha`,
      );
    }
  }
}
