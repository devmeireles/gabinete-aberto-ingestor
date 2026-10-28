import type { SyncDeputados } from "@/application/use-cases/sync-deputados";
import type { SyncPartidos } from "@/application/use-cases/sync-partidos";
import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import type { SyncDeputadosPageResult } from "@/application/use-cases/sync-deputados";
import type { SyncPartidosPageResult } from "@/application/use-cases/sync-partidos";
import {
  CAMARA_API_CONCURRENCY,
  inngest,
} from "@/infrastructure/inngest/client";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";

const MAX_PAGES: number = 50;
const PROFILE_EVENT_BATCH_SIZE: number = 20;

export interface SeedDeputadosSummary {
  readonly legislaturaId: number;
  readonly partyPages: number;
  readonly deputyPages: number;
  readonly deputies: number;
  readonly profilesQueued: number;
  readonly written: number;
  readonly unchanged: number;
}

export function parseSeedLegislaturaId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      "Informe legislaturaId como inteiro positivo no evento camara/deputados.seed",
    );
  }
  return value;
}

export function createProfileSeedEvents(deputadoIds: readonly number[]) {
  return deputadoIds.map((deputadoId) => ({
    name: "camara/deputados.perfil.seed",
    data: { deputadoId },
  }));
}

export function createSeedDeputadosFunction(
  syncPartidos: SyncPartidos,
  syncDeputados: SyncDeputados,
  runRepository: CrawlerRunRepository,
) {
  return inngest.createFunction(
    {
      id: "seed-deputados",
      triggers: [{ event: "camara/deputados.seed" }],
      retries: 5,
      concurrency: CAMARA_API_CONCURRENCY,
      singleton: { mode: "skip" },
    },
    async ({ step, runId, attempt, event }): Promise<SeedDeputadosSummary> =>
      runTrackedCrawler(
        runRepository,
        "seed-deputados",
        { runId, attempt, eventName: event.name },
        async (): Promise<SeedDeputadosSummary> => {
          const legislaturaId: number = parseSeedLegislaturaId(
            event.data["legislaturaId"],
          );
          const partidos = new Map<number, string>();
          let partyPage: number = 1;
          let partyPages: number = 0;

          for (;;) {
            const currentPage: number = partyPage;
            const result: SyncPartidosPageResult = await step.run(
              `partidos-pagina-${currentPage}`,
              () => syncPartidos.executePage(legislaturaId, currentPage),
            );
            for (const partido of result.partidos) {
              partidos.set(partido.id, partido.sigla);
            }
            partyPages++;
            if (!result.hasNext) break;
            if (partyPage >= MAX_PAGES) {
              throw new Error(
                `seed-deputados passou de ${MAX_PAGES} páginas de partidos`,
              );
            }
            partyPage++;
          }

          let deputyPage: number = 1;
          let deputyPages: number = 0;
          let deputies: number = 0;
          let profilesQueued: number = 0;
          let written: number = 0;
          let unchanged: number = 0;
          const seenDeputies = new Set<number>();

          for (;;) {
            const currentPage: number = deputyPage;
            const result: SyncDeputadosPageResult = await step.run(
              `deputados-pagina-${currentPage}`,
              () =>
                syncDeputados.executePage(
                  legislaturaId,
                  currentPage,
                  partidos,
                  seenDeputies,
                ),
            );
            deputyPages++;
            deputies += result.validated;
            written += result.written;
            unchanged += result.unchanged;
            result.deputadoIds.forEach((id) => seenDeputies.add(id));

            for (
              let offset: number = 0;
              offset < result.deputadoIds.length;
              offset += PROFILE_EVENT_BATCH_SIZE
            ) {
              const ids: readonly number[] = result.deputadoIds.slice(
                offset,
                offset + PROFILE_EVENT_BATCH_SIZE,
              );
              const batch: number =
                Math.floor(offset / PROFILE_EVENT_BATCH_SIZE) + 1;
              await step.sendEvent(
                `deputados-pagina-${currentPage}-perfis-lote-${batch}`,
                createProfileSeedEvents(ids),
              );
              profilesQueued += ids.length;
            }

            if (!result.hasNext) break;
            if (deputyPage >= MAX_PAGES) {
              throw new Error(
                `seed-deputados passou de ${MAX_PAGES} páginas de deputados`,
              );
            }
            deputyPage++;
          }

          return {
            legislaturaId,
            partyPages,
            deputyPages,
            deputies,
            profilesQueued,
            written,
            unchanged,
          };
        },
      ),
  );
}
