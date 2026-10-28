import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import type { PartidoRepository } from "@/application/ports/partido-repository";
import type { EnrichPartido } from "@/application/use-cases/enrich-partido";
import {
  CAMARA_API_CONCURRENCY,
  inngest,
} from "@/infrastructure/inngest/client";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";

export interface SeedPerfilPartidoSummary {
  readonly requestedPartidoId?: number;
  readonly enriched: number;
}

export function parseSeedPartidoId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      "Informe partidoId como inteiro positivo no evento camara/partidos.perfil.seed",
    );
  }
  return value;
}

export function selectPartidoIds(
  requestedPartidoId: number | undefined,
  registeredPartidoIds: readonly number[],
): readonly number[] {
  if (requestedPartidoId !== undefined) return [requestedPartidoId];
  if (registeredPartidoIds.length === 0) {
    throw new Error(
      "Nenhum partido cadastrado. Execute camara/partidos.seed antes do seed de perfis.",
    );
  }
  return registeredPartidoIds;
}

export function createSeedPerfilPartidoFunction(
  enrichPartido: EnrichPartido,
  partidoRepository: PartidoRepository,
  runRepository: CrawlerRunRepository,
) {
  return inngest.createFunction(
    {
      id: "seed-perfis-partidos",
      triggers: [{ event: "camara/partidos.perfil.seed" }],
      retries: 5,
      concurrency: CAMARA_API_CONCURRENCY,
    },
    async ({
      step,
      runId,
      attempt,
      event,
    }): Promise<SeedPerfilPartidoSummary> =>
      runTrackedCrawler(
        runRepository,
        "seed-perfis-partidos",
        { runId, attempt, eventName: event.name },
        async (): Promise<SeedPerfilPartidoSummary> => {
          const requestedPartidoId: number | undefined = parseSeedPartidoId(
            event.data["partidoId"],
          );
          const registeredPartidoIds: readonly number[] =
            requestedPartidoId === undefined
              ? await partidoRepository.listIds()
              : [];
          const partidoIds: readonly number[] = selectPartidoIds(
            requestedPartidoId,
            registeredPartidoIds,
          );
          let enriched: number = 0;
          for (const partidoId of partidoIds) {
            await step.run(`partido-perfil-${partidoId}`, () =>
              enrichPartido.execute(partidoId).then(() => ({ enriched: true })),
            );
            enriched++;
          }
          return {
            ...(requestedPartidoId === undefined ? {} : { requestedPartidoId }),
            enriched,
          };
        },
      ),
  );
}
