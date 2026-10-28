import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import type { EnrichDeputado } from "@/application/use-cases/enrich-deputado";
import {
  CAMARA_API_CONCURRENCY,
  inngest,
} from "@/infrastructure/inngest/client";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";

export interface SeedPerfilDeputadoSummary {
  readonly deputadoId: number;
  readonly enriched: number;
}

export function parseSeedDeputadoId(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      "Informe deputadoId como inteiro positivo no evento camara/deputados.perfil.seed",
    );
  }
  return value;
}

export function createSeedPerfilDeputadoFunction(
  enrichDeputado: EnrichDeputado,
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
          const deputadoId: number = parseSeedDeputadoId(
            event.data["deputadoId"],
          );
          await step.run(`deputado-perfil-${deputadoId}`, () =>
            enrichDeputado.execute(deputadoId).then(() => ({ enriched: true })),
          );
          return { deputadoId, enriched: 1 };
        },
      ),
  );
}
