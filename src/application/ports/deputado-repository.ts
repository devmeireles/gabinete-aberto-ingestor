import type { Deputado, DeputadoLegislatura } from "@/domain/model/deputado";
import type { UpsertResult } from "@/application/ports/legislatura-repository";

export interface DeputadoRepository {
  upsertMany(
    deputados: readonly Deputado[],
    legislaturas: readonly DeputadoLegislatura[],
    sourcePayloadId: number,
  ): Promise<UpsertResult>;
}
