import type {
  Partido,
  PartidoDetalhe,
  PartidoLegislatura,
} from "@/domain/model/partido";
import type { UpsertResult } from "@/application/ports/legislatura-repository";

export interface PartidoRepository {
  listIds(): Promise<readonly number[]>;
  upsertMany(
    partidos: readonly Partido[],
    legislaturas: readonly PartidoLegislatura[],
    sourcePayloadId: number,
  ): Promise<UpsertResult>;
  upsertDetalhe(
    detalhe: PartidoDetalhe,
    sourcePayloadId: number,
  ): Promise<void>;
}
