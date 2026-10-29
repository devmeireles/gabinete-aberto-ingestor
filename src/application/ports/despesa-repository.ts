import type { BilheteAereoCsv, Despesa } from "@/domain/model/despesa";
import type { DespesaDto } from "@/application/ports/camara-gateway/despesas";
import type { UpsertResult } from "@/application/ports/legislatura-repository";

/** Unnormalized source data retained when an expense cannot be identified. */
export type RejectedDespesaPayload = DespesaDto & {
  readonly deputadoId: number;
  readonly legislaturaId: number;
};

export interface RejectedDespesa {
  readonly payload: RejectedDespesaPayload;
  readonly reason: "missing_document_code";
}

export interface CsvEnrichmentResult {
  readonly imported: number;
  readonly enriched: number;
  readonly ambiguous: number;
}

export interface DespesaSyncResult extends UpsertResult {
  readonly conflicted: number;
  readonly enriched: number;
  readonly ambiguous: number;
}

export interface DespesaRepository {
  getActiveLegislaturaId(asOf: string): Promise<number>;
  listDeputadoIds(legislaturaId: number): Promise<readonly number[]>;
  upsertMany(
    items: readonly Despesa[],
    sourcePayloadId: number,
    rejectedItems?: readonly RejectedDespesa[],
  ): Promise<DespesaSyncResult>;
  importBilhetesCsv(
    items: readonly BilheteAereoCsv[],
  ): Promise<CsvEnrichmentResult>;
  enrichFromBilhetesCsv(
    year?: number,
  ): Promise<Omit<CsvEnrichmentResult, "imported">>;
}
