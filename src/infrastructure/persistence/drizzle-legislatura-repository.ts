import { sql } from "drizzle-orm";
import type {
  LegislaturaRepository,
  UpsertResult,
} from "../../application/ports/legislatura-repository.js";
import type { Legislatura } from "../../domain/model/legislatura.js";
import { canonicalHash } from "../../shared/canonical-hash.js";
import type { Database } from "./client.js";
import { legislaturas } from "./schema.js";

export class DrizzleLegislaturaRepository implements LegislaturaRepository {
  constructor(private readonly db: Database) {}

  async upsertMany(
    items: readonly Legislatura[],
    sourcePayloadId: number,
  ): Promise<UpsertResult> {
    if (items.length === 0) {
      return { written: 0, unchanged: 0 };
    }

    const rows = items.map((item: Legislatura) => ({
      id: item.id,
      uri: item.uri,
      dataInicio: item.dataInicio,
      dataFim: item.dataFim,
      legislaturaAtual: item.legislaturaAtual,
      rowHash: canonicalHash({
        id: item.id,
        uri: item.uri,
        dataInicio: item.dataInicio,
        dataFim: item.dataFim,
      }),
      sourcePayloadId,
    }));

    return this.db.transaction(async (tx) => {
      const changed: Array<{ id: number }> = await tx
        .insert(legislaturas)
        .values(rows)
        .onConflictDoUpdate({
          target: legislaturas.id,
          set: {
            uri: sql`excluded.uri`,
            dataInicio: sql`excluded.data_inicio`,
            dataFim: sql`excluded.data_fim`,
            rowHash: sql`excluded.row_hash`,
            sourcePayloadId: sql`excluded.source_payload_id`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${legislaturas.rowHash} IS DISTINCT FROM excluded.row_hash`,
        })
        .returning({ id: legislaturas.id });

      const today = sql`(timezone('America/Sao_Paulo', now()))::date`;
      const isCurrent = sql`${legislaturas.dataInicio} <= ${today} AND (${legislaturas.dataFim} IS NULL OR ${legislaturas.dataFim} >= ${today})`;
      await tx
        .update(legislaturas)
        .set({ legislaturaAtual: isCurrent })
        .where(
          sql`${legislaturas.legislaturaAtual} IS DISTINCT FROM (${isCurrent})`,
        );

      return {
        written: changed.length,
        unchanged: rows.length - changed.length,
      };
    });
  }
}
