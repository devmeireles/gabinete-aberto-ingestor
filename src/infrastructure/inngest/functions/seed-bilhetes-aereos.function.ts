import type { BilheteAereoCsvArchiveSource } from "@/application/ports/bilhete-aereo-csv-archive-source";
import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import type {
  ImportBilhetesAereosCsv,
  ImportBilhetesCsvResult,
} from "@/application/use-cases/import-bilhetes-aereos-csv";
import { inngest } from "@/infrastructure/inngest/client";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";
import { currentDateInBrazil } from "@/shared/date";

const FIRST_YEAR: number = 2008;
const SEED_CONCURRENCY = {
  limit: 1,
  key: '"bilhetes-aereos-seed"',
  scope: "env" as const,
};

interface YearSummary {
  readonly scanned: number;
  readonly candidates: number;
  readonly imported: number;
  readonly enriched: number;
  readonly ambiguous: number;
}

export interface SeedBilhetesAereosSummary {
  readonly years: number;
  readonly scanned: number;
  readonly candidates: number;
  readonly imported: number;
  readonly enriched: number;
  readonly ambiguous: number;
}

export function selectBilheteSeedYears(
  requestedYear: unknown,
  currentYear: number,
): readonly number[] {
  if (requestedYear === undefined) {
    return Array.from(
      { length: currentYear - FIRST_YEAR + 1 },
      (_unused, index) => FIRST_YEAR + index,
    );
  }
  if (
    typeof requestedYear !== "number" ||
    !Number.isInteger(requestedYear) ||
    requestedYear < FIRST_YEAR ||
    requestedYear > currentYear
  ) {
    throw new Error(
      `Informe ano como inteiro entre ${FIRST_YEAR} e ${currentYear}`,
    );
  }
  return [requestedYear];
}

export function createSeedBilhetesAereosFunction(
  useCase: ImportBilhetesAereosCsv,
  archiveSource: BilheteAereoCsvArchiveSource,
  runRepository: CrawlerRunRepository,
) {
  return inngest.createFunction(
    {
      id: "seed-bilhetes-aereos",
      triggers: [{ event: "camara/bilhetes-aereos.seed" }],
      retries: 5,
      concurrency: SEED_CONCURRENCY,
      singleton: { mode: "skip" },
    },
    async ({
      step,
      runId,
      attempt,
      event,
    }): Promise<SeedBilhetesAereosSummary> =>
      runTrackedCrawler(
        runRepository,
        "seed-bilhetes-aereos",
        { runId, attempt, eventName: event.name },
        async (): Promise<SeedBilhetesAereosSummary> => {
          const currentYear: number = Number(currentDateInBrazil().slice(0, 4));
          const years: readonly number[] = selectBilheteSeedYears(
            event.data["ano"],
            currentYear,
          );
          const yearSummaries: YearSummary[] = [];

          for (const year of years) {
            const result: ImportBilhetesCsvResult = await step.run(
              `bilhetes-csv-${year}`,
              async () => {
                const archive = await archiveSource.openCsv(year);
                return useCase.importStream(archive.fileName, archive.content);
              },
            );
            const enrichment = await step.run(
              `bilhetes-csv-reconciliar-${year}`,
              () => useCase.reconcile(year),
            );
            yearSummaries.push({
              scanned: result.scanned,
              candidates: result.candidates,
              imported: result.imported,
              ...enrichment,
            });
          }

          return {
            years: yearSummaries.length,
            scanned: yearSummaries.reduce(
              (total, result) => total + result.scanned,
              0,
            ),
            candidates: yearSummaries.reduce(
              (total, result) => total + result.candidates,
              0,
            ),
            imported: yearSummaries.reduce(
              (total, result) => total + result.imported,
              0,
            ),
            enriched: yearSummaries.reduce(
              (total, result) => total + result.enriched,
              0,
            ),
            ambiguous: yearSummaries.reduce(
              (total, result) => total + result.ambiguous,
              0,
            ),
          };
        },
      ),
  );
}
