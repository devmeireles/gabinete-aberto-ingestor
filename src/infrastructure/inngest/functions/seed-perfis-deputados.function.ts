import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import type { DeputadoRepository } from "@/application/ports/deputado-repository";
import type { EnrichDeputado } from "@/application/use-cases/enrich-deputado";
import {
  CAMARA_API_CONCURRENCY,
  inngest,
} from "@/infrastructure/inngest/client";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";

export interface SeedPerfilDeputadoSummary {
  readonly requestedDeputadoId?: number;
  readonly enriched: number;
}

export function parseSeedDeputadoId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      "Informe deputadoId como inteiro positivo no evento camara/deputados.perfil.seed",
    );
  }
  return value;
}

export function selectDeputadoIds(
  requestedDeputadoId: number | undefined,
  registeredDeputadoIds: readonly number[],
): readonly number[] {
  if (requestedDeputadoId !== undefined) return [requestedDeputadoId];
  if (registeredDeputadoIds.length === 0) {
    throw new Error(
      "Nenhum deputado cadastrado. Execute camara/deputados.seed antes do seed de perfis.",
    );
  }
  return registeredDeputadoIds;
}

export function createSeedPerfilDeputadoFunction(
  enrichDeputado: EnrichDeputado,
  deputadoRepository: DeputadoRepository,
  runRepository: CrawlerRunRepository,
) {
  return inngest.createFunction(
    {
      id: "seed-perfis-deputados",
      triggers: [{ event: "camara/deputados.perfil.seed" }],
      retries: 5,
      concurrency: CAMARA_API_CONCURRENCY,
    },
    async ({
      step,
      runId,
      attempt,
      event,
    }): Promise<SeedPerfilDeputadoSummary> =>
      runTrackedCrawler(
        runRepository,
        "seed-perfis-deputados",
        { runId, attempt, eventName: event.name },
        async (): Promise<SeedPerfilDeputadoSummary> => {
          const requestedDeputadoId: number | undefined = parseSeedDeputadoId(
            event.data["deputadoId"],
          );
          const registeredDeputadoIds: readonly number[] =
            requestedDeputadoId === undefined
              ? await step.run("listar-deputados-cadastrados", () =>
                  deputadoRepository.listIds(),
                )
              : [];
          const deputadoIds: readonly number[] = selectDeputadoIds(
            requestedDeputadoId,
            registeredDeputadoIds,
          );
          let enriched: number = 0;
          for (const deputadoId of deputadoIds) {
            await step.run(`deputado-perfil-${deputadoId}`, () =>
              enrichDeputado
                .execute(deputadoId)
                .then(() => ({ enriched: true })),
            );
            enriched++;
          }
          return {
            ...(requestedDeputadoId === undefined
              ? {}
              : { requestedDeputadoId }),
            enriched,
          };
        },
      ),
  );
}
