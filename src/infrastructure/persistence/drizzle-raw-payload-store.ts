import { sql } from "drizzle-orm";
import type { RawPayloadStore } from "../../application/ports/raw-payload-store.js";
import { canonicalHash } from "../../shared/canonical-hash.js";
import type { Database } from "./client.js";
import { rawPayloads } from "./schema.js";

export class DrizzleRawPayloadStore implements RawPayloadStore {
  constructor(private readonly db: Database) {}

  async save(requestKey: string, body: unknown): Promise<number> {
    const contentHash: string = canonicalHash(body);

    // DO UPDATE (em vez de DO NOTHING) para o RETURNING sempre devolver o id,
    // inclusive quando o corpo já existia. Efeito colateral útil: atualiza
    // last_seen_at, mostrando que a fonte continua devolvendo o mesmo conteúdo.
    const rows: Array<{ id: number }> = await this.db
      .insert(rawPayloads)
      .values({ requestKey, contentHash, payload: body })
      .onConflictDoUpdate({
        target: [rawPayloads.requestKey, rawPayloads.contentHash],
        set: { lastSeenAt: sql`now()` },
      })
      .returning({ id: rawPayloads.id });

    const row: { id: number } | undefined = rows[0];
    if (row === undefined) {
      throw new Error(`Falha ao salvar payload bruto de ${requestKey}`);
    }
    return row.id;
  }
}
