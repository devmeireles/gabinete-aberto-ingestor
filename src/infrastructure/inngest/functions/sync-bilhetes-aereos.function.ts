import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import type { ImportBilhetesAereosCsv } from "@/application/use-cases/import-bilhetes-aereos-csv";
import { selectBilheteYears } from "@/application/use-cases/select-bilhete-years";
import { inngest } from "@/infrastructure/inngest/client";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";
import { currentDateInBrazil } from "@/shared/date";

export function createSyncBilhetesAereosFunction(
  useCase: Pick<ImportBilhetesAereosCsv, "reconcile">,
  runRepository: CrawlerRunRepository,
) {
  return inngest.createFunction(
    {
      id: "sync-bilhetes-aereos",
      triggers: [
        { event: "camara/bilhetes-aereos.sync" },
        { cron: "TZ=America/Sao_Paulo 0 4 * * 0" },
      ],
      retries: 5,
      concurrency: { limit: 1 },
      singleton: { mode: "skip" },
    },
    async ({ step, runId, attempt, event }) =>
      runTrackedCrawler(
        runRepository,
        "sync-bilhetes-aereos",
        { runId, attempt, eventName: event.name },
        async () => {
          const years = selectBilheteYears(
            "ano" in event.data ? event.data.ano : undefined,
            Number(currentDateInBrazil().slice(0, 4)),
          );
          let enriched = 0;
          let ambiguous = 0;
          let removed = 0;
          for (const year of years) {
            const result = await step.run(`bilhetes-reconciliar-${year}`, () =>
              useCase.reconcile(year),
            );
            enriched += result.enriched;
            ambiguous += result.ambiguous;
            removed += result.removed ?? 0;
          }
          return { years: years.length, enriched, ambiguous, removed };
        },
      ),
  );
}
