import type { Legislatura } from "@/domain/model/legislatura";

export interface UpsertResult {
  /** Linhas inseridas ou efetivamente alteradas. */
  readonly written: number;
  /** Linhas idênticas ao que já existia (nada foi escrito). */
  readonly unchanged: number;
}

export interface LegislaturaRepository {
  upsertMany(
    items: readonly Legislatura[],
    sourcePayloadId: number,
  ): Promise<UpsertResult>;
}
