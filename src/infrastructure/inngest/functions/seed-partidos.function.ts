import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import type {
  SyncPartidos,
  SyncPartidosPageResult,
} from "@/application/use-cases/sync-partidos";
import {
  CAMARA_API_CONCURRENCY,
  inngest,
} from "@/infrastructure/inngest/client";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";

const MAX_PAGES: number = 50;
const PROFILE_EVENT_BATCH_SIZE: number = 20;

export interface SeedPartidosSummary {
  readonly legislaturaId: number;
  readonly pages: number;
  readonly parties: number;
  readonly profilesQueued: number;
  readonly written: number;
  readonly unchanged: number;
}

export function parseSeedPartidosLegislaturaId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      "Informe legislaturaId como inteiro positivo no evento camara/partidos.seed",
    );
  }
  return value;
}

export function createPartidoProfileSeedEvents(partidoIds: readonly number[]) {
  return partidoIds.map((partidoId) => ({
    name: "camara/partidos.perfil.seed",
    data: { partidoId },
  }));
}

export function createSeedPartidosFunction(
  syncPartidos: SyncPartidos,
  runRepository: CrawlerRunRepository,
) {
  return inngest.createFunction(
    {
      id: "seed-partidos",
      triggers: [{ event: "camara/partidos.seed" }],
      retries: 5,
      concurrency: CAMARA_API_CONCURRENCY,
      singleton: { mode: "skip" },
    },
    async ({ step, runId, attempt, event }): Promise<SeedPartidosSummary> =>
      runTrackedCrawler(
        runRepository,
        "seed-partidos",
        { runId, attempt, eventName: event.name },
        async (): Promise<SeedPartidosSummary> => {
          const legislaturaId: number = parseSeedPartidosLegislaturaId(
            event.data["legislaturaId"],
          );
          let pagina: number = 1;
          let parties: number = 0;
          let profilesQueued: number = 0;
          let written: number = 0;
          let unchanged: number = 0;

          for (;;) {
            const currentPage: number = pagina;
            const result: SyncPartidosPageResult = await step.run(
              `partidos-pagina-${currentPage}`,
              () => syncPartidos.executePage(legislaturaId, currentPage),
            );
            parties += result.fetched;
            written += result.written;
            unchanged += result.unchanged;

            for (
              let offset: number = 0;
              offset < result.partidos.length;
              offset += PROFILE_EVENT_BATCH_SIZE
            ) {
              const ids: readonly number[] = result.partidos
                .slice(offset, offset + PROFILE_EVENT_BATCH_SIZE)
                .map(({ id }) => id);
              const batch: number =
                Math.floor(offset / PROFILE_EVENT_BATCH_SIZE) + 1;
              await step.sendEvent(
                `partidos-pagina-${currentPage}-perfis-lote-${batch}`,
                createPartidoProfileSeedEvents(ids),
              );
              profilesQueued += ids.length;
            }

            if (!result.hasNext) break;
            if (pagina >= MAX_PAGES) {
              throw new Error(
                `seed-partidos passou de ${MAX_PAGES} páginas: abortando`,
              );
            }
            pagina++;
          }

          return {
            legislaturaId,
            pages: pagina,
            parties,
            profilesQueued,
            written,
            unchanged,
          };
        },
      ),
  );
}
