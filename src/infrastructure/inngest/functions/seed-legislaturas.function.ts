import type {
  SyncLegislaturas,
  SyncPageResult,
} from "@/application/use-cases/sync-legislaturas";
import {
  CAMARA_API_CONCURRENCY,
  inngest,
} from "@/infrastructure/inngest/client";
import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";

/** Trava de segurança: se hasNext nunca virar false, não rodamos para sempre. */
const MAX_PAGES: number = 50;

export interface SyncLegislaturasSummary {
  readonly pages: number;
  readonly fetched: number;
  readonly written: number;
  readonly unchanged: number;
}

/**
 * ADAPTER Inngest: só orquestra. Nenhuma regra de negócio mora aqui.
 *
 * - Um `step.run` por página: cada um é memoizado e tem retry próprio. Se a
 *   página 3 falha, as páginas 1 e 2 NÃO são refeitas.
 * - O id do step inclui o número da página: o Inngest usa o id para
 *   memoizar, então precisa ser único e estável dentro do run.
 * - singleton "skip": se o run anterior ainda está ativo, o novo é ignorado
 *   (sem sobreposição de cargas concorrentes).
 */
export function createSeedLegislaturasFunction(
  useCase: SyncLegislaturas,
  runRepository: CrawlerRunRepository,
) {
  return inngest.createFunction(
    {
      id: "seed-legislaturas",
      triggers: [{ event: "camara/legislaturas.seed" }],
      retries: 5,
      concurrency: CAMARA_API_CONCURRENCY,
      singleton: { mode: "skip" },
    },
    async ({ step, runId, attempt, event }): Promise<SyncLegislaturasSummary> =>
      runTrackedCrawler(
        runRepository,
        "seed-legislaturas",
        { runId, attempt, eventName: event.name },
        async (): Promise<SyncLegislaturasSummary> => {
          let pagina: number = 1;
          let fetched: number = 0;
          let written: number = 0;
          let unchanged: number = 0;

          for (;;) {
            const currentPage: number = pagina; // valor fixo por iteração, seguro para a closure
            const result: SyncPageResult = await step.run(
              `legislaturas-pagina-${currentPage}`,
              () => useCase.executePage(currentPage),
            );
            fetched += result.fetched;
            written += result.written;
            unchanged += result.unchanged;

            if (!result.hasNext) break;
            if (pagina >= MAX_PAGES) {
              throw new Error(
                `seed-legislaturas passou de ${MAX_PAGES} páginas: abortando`,
              );
            }
            pagina++;
          }

          return { pages: pagina, fetched, written, unchanged };
        },
      ),
  );
}
