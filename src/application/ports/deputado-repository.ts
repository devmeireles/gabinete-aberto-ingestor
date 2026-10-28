import type {
  Deputado,
  DeputadoLegislatura,
  DeputadoPartidoVigencia,
} from "@/domain/model/deputado";
import type { UpsertResult } from "@/application/ports/legislatura-repository";

export interface DeputadoPartidoHistoricoSnapshot {
  readonly deputadoId: number;
  readonly legislaturaId: number;
  readonly vigencias: readonly DeputadoPartidoVigencia[];
  readonly sourcePayloadId: number;
}

export interface DeputadoPageSnapshot {
  readonly deputados: readonly Deputado[];
  readonly legislaturas: readonly DeputadoLegislatura[];
  readonly sourcePayloadId: number;
  readonly historicos: readonly DeputadoPartidoHistoricoSnapshot[];
}

export interface DeputadoRepository {
  syncPage(snapshot: DeputadoPageSnapshot): Promise<UpsertResult>;
}
