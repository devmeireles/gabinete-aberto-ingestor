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
      // Hash só dos campos de negócio: é ele que decide se vale escrever.
      rowHash: canonicalHash(item),
      sourcePayloadId,
    }));

    // setWhere: se o hash é igual, a linha NÃO é tocada (sem write, sem
    // updated_at falso, sem WAL à toa). Só o que mudou volta no RETURNING.
    const changed: Array<{ id: number }> = await this.db
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

    return { written: changed.length, unchanged: rows.length - changed.length };
  }
}
