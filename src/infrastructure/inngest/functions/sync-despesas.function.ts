import type {
  SyncDespesas,
  SyncDespesasMonthResult,
} from "@/application/use-cases/sync-despesas";
import {
  CAMARA_API_CONCURRENCY,
  inngest,
} from "@/infrastructure/inngest/client";
import { currentDateInBrazil } from "@/shared/date";
import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";

interface Month {
  readonly ano: number;
  readonly mes: number;
}

export interface SyncDespesasSummary {
  readonly legislaturaId: number;
  readonly deputados: number;
  readonly months: number;
  readonly fetched: number;
  readonly written: number;
  readonly unchanged: number;
  readonly enriched: number;
  readonly ambiguous: number;
}

function recentMonths(now: Date): readonly Month[] {
  return [0, 1, 2].map((offset) => {
    const date: Date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
    );
    return { ano: date.getUTCFullYear(), mes: date.getUTCMonth() + 1 };
  });
}

export function createSyncDespesasFunction(
  useCase: SyncDespesas,
  runRepository: CrawlerRunRepository,
) {
  return inngest.createFunction(
    {
      id: "sync-despesas",
      triggers: [{ cron: "TZ=America/Sao_Paulo 0 3 * * 0" }],
      retries: 5,
      concurrency: CAMARA_API_CONCURRENCY,
      singleton: { mode: "skip" },
    },
    async ({ step, runId, attempt, event }): Promise<SyncDespesasSummary> =>
      runTrackedCrawler(
        runRepository,
        "sync-despesas",
        { runId, attempt, eventName: event.name },
        async (): Promise<SyncDespesasSummary> => {
          const today: string = currentDateInBrazil();
          const legislaturaId: number = await step.run(
            "despesas-legislatura-ativa",
            () => useCase.getActiveLegislaturaId(today),
          );
          const deputadoIds: readonly number[] = await step.run(
            `despesas-deputados-legislatura-${legislaturaId}`,
            () => useCase.listDeputadoIds(legislaturaId),
          );
          if (deputadoIds.length === 0) {
            throw new Error(
              `Nenhum deputado cadastrado para a legislatura ${legislaturaId}; sincronize deputados antes das despesas`,
            );
          }

          const months: readonly Month[] = recentMonths(new Date());
          let fetched: number = 0;
          let written: number = 0;
          let unchanged: number = 0;
          let enriched: number = 0;
          let ambiguous: number = 0;

          for (const deputadoId of deputadoIds) {
            const results: readonly SyncDespesasMonthResult[] = await step.run(
              `despesas-deputado-${deputadoId}`,
              async () => {
                const completed: SyncDespesasMonthResult[] = [];
                for (const month of months) {
                  completed.push(
                    await useCase.executeDeputadoMonth(
                      deputadoId,
                      legislaturaId,
                      month.ano,
                      month.mes,
                    ),
                  );
                }
                return completed;
              },
            );
            for (const result of results) {
              fetched += result.fetched;
              written += result.written;
              unchanged += result.unchanged;
              enriched += result.enriched;
              ambiguous += result.ambiguous;
            }
          }

          return {
            legislaturaId,
            deputados: deputadoIds.length,
            months: deputadoIds.length * months.length,
            fetched,
            written,
            unchanged,
            enriched,
            ambiguous,
          };
        },
      ),
  );
}
