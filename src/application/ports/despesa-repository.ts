import type { BilheteAereoCsv, Despesa } from "@/domain/model/despesa";
import type { UpsertResult } from "@/application/ports/legislatura-repository";

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
  ): Promise<DespesaSyncResult>;
  importBilhetesCsv(
    items: readonly BilheteAereoCsv[],
  ): Promise<CsvEnrichmentResult>;
  enrichFromBilhetesCsv(
    year?: number,
  ): Promise<Omit<CsvEnrichmentResult, "imported">>;
}
