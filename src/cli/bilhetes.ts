import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  ImportBilhetesAereosCsv,
  type ImportBilhetesCsvResult,
} from "@/application/use-cases/import-bilhetes-aereos-csv";
import { StreamingBilheteAereoCsvSource } from "@/infrastructure/csv/streaming-bilhete-aereo-csv-source";
import { HttpBilheteAereoCsvArchiveSource } from "@/infrastructure/csv/http-bilhete-aereo-csv-archive-source";
import { runTrackedCrawler } from "@/application/use-cases/run-tracked-crawler";
import { selectBilheteYears } from "@/application/use-cases/select-bilhete-years";
import { createDatabase } from "@/infrastructure/persistence/client";
import { DrizzleDespesaRepository } from "@/infrastructure/persistence/drizzle-despesa-repository";
import { DrizzleCrawlerRunRepository } from "@/infrastructure/persistence/drizzle-crawler-run-repository";
import { currentDateInBrazil } from "@/shared/date";

export function parseBilheteSyncOptions(
  args: readonly string[],
): readonly number[] {
  let year: number | undefined;
  let persist = false;
  let importCsv = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--import" && !importCsv) {
      importCsv = true;
      continue;
    }
    if (arg === "--persist" && !persist) {
      persist = true;
      continue;
    }
    if (arg === "--ano" || arg.startsWith("--ano=")) {
      if (year !== undefined) throw new Error("Informe --ano apenas uma vez");
      const value =
        arg === "--ano" ? args[++index] : arg.slice("--ano=".length);
      if (!value?.trim()) throw new Error("Informe --ano=<AAAA>");
      year = Number(value);
      continue;
    }
    throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (!persist)
    throw new Error(
      "Informe --persist para reconciliar e consumir bilhetes correspondentes",
    );
  return selectBilheteYears(year, Number(currentDateInBrazil().slice(0, 4)));
}

export async function runBilhetes(args: readonly string[]): Promise<void> {
  const years = parseBilheteSyncOptions(args);
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl?.trim())
    throw new Error("DATABASE_URL é obrigatória para usar --persist");
  const importCsv = args.includes("--import");
  const database = createDatabase(databaseUrl);
  try {
    const repository = new DrizzleDespesaRepository(database.db);
    const runs = new DrizzleCrawlerRunRepository(database.db);
    const importer = new ImportBilhetesAereosCsv(
      new StreamingBilheteAereoCsvSource(),
      repository,
    );
    const archives = new HttpBilheteAereoCsvArchiveSource();
    for (const year of years) {
      const runId = `cli-bilhetes-${randomUUID()}-${year}`;
      const summary = await runTrackedCrawler(
        runs,
        "cli-sync-bilhetes-aereos",
        { runId, attempt: 0, eventName: "cli/bilhetes-aereos.sync" },
        async () => {
          const before = await repository.getBilheteSyncStats(year);
          console.log(
            JSON.stringify({
              event: "crawler.bilhetes.started",
              runId,
              ano: year,
              importCsv,
              ...before,
            }),
          );
          let imported = 0;
          let scanned = 0;
          let candidates = 0;
          let skipped = 0;
          let skippedSamples: ImportBilhetesCsvResult["skippedSamples"] = [];
          let replacedLegacy = 0;
          if (importCsv) {
            console.log(
              JSON.stringify({
                event: "crawler.bilhetes.import.started",
                runId,
                ano: year,
              }),
            );
            const archive = await archives.openCsv(year);
            const result = await importer.importStream(
              archive.fileName,
              archive.content,
              (progress) => {
                console.log(
                  JSON.stringify({
                    event: "crawler.bilhetes.import.progress",
                    runId,
                    ano: year,
                    ...progress,
                  }),
                );
              },
            );
            imported = result.imported;
            scanned = result.scanned;
            candidates = result.candidates;
            skipped = result.skipped;
            skippedSamples = result.skippedSamples;
            replacedLegacy = result.removed;
            console.log(
              JSON.stringify({
                event: "crawler.bilhetes.import.completed",
                runId,
                ano: year,
                ...result,
              }),
            );
          } else if (
            before.pendingTickets > 0 &&
            before.ticketsWithKnownDeputy === 0
          ) {
            console.warn(
              JSON.stringify({
                event: "crawler.bilhetes.reimport_required",
                runId,
                ano: year,
                message:
                  "Nenhum ID de bilhete corresponde aos deputados cadastrados. Reimporte usando ideCadastro e confirme que os deputados foram carregados.",
                command: `npm run crawler -- bilhetes --ano=${year} --import --persist`,
              }),
            );
          }
          const result = await importer.reconcile(year);
          const after = await repository.getBilheteSyncStats(year);
          return {
            ano: year,
            importCsv,
            scanned,
            candidates,
            skipped,
            skippedSamples,
            imported,
            ...result,
            removed: replacedLegacy + result.removed,
            replacedLegacy,
            pendingTickets: after.pendingTickets,
            ticketsWithKnownDeputy: after.ticketsWithKnownDeputy,
            ticketsWithoutDocumentCode: after.ticketsWithoutDocumentCode,
          };
        },
      );
      console.log(
        JSON.stringify({
          event: "crawler.bilhetes.completed",
          runId,
          ...summary,
        }),
      );
    }
  } finally {
    await database.pool.end();
  }
}
