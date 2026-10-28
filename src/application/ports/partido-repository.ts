import type { Partido, PartidoLegislatura } from "@/domain/model/partido";
import type { UpsertResult } from "@/application/ports/legislatura-repository";

export interface PartidoRepository {
  upsertMany(
    partidos: readonly Partido[],
    legislaturas: readonly PartidoLegislatura[],
    sourcePayloadId: number,
  ): Promise<UpsertResult>;
}
