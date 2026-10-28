import { sql } from "drizzle-orm";
import type { DeputadoRepository } from "@/application/ports/deputado-repository";
import type { UpsertResult } from "@/application/ports/legislatura-repository";
import type { Deputado, DeputadoLegislatura } from "@/domain/model/deputado";
import { canonicalHash } from "@/shared/canonical-hash";
import type { Database } from "./client";
import { deputadoLegislaturas, deputados } from "./schema";

export class DrizzleDeputadoRepository implements DeputadoRepository {
  constructor(private readonly db: Database) {}

  async upsertMany(
    items: readonly Deputado[],
    memberships: readonly DeputadoLegislatura[],
    sourcePayloadId: number,
  ): Promise<UpsertResult> {
    if (items.length !== memberships.length) {
      throw new Error("Cada deputado deve ter uma associação de legislatura");
    }
    if (items.length === 0) {
      return { written: 0, unchanged: 0 };
    }

    return this.db.transaction(async (tx) => {
      const deputyRows = items.map((item: Deputado) => ({
        ...item,
        rowHash: canonicalHash(item),
        sourcePayloadId,
      }));
      const changedDeputies = await tx
        .insert(deputados)
        .values(deputyRows)
        .onConflictDoUpdate({
          target: deputados.id,
          set: {
            nome: sql`excluded.nome`,
            uri: sql`excluded.uri`,
            urlFoto: sql`excluded.url_foto`,
            rowHash: sql`excluded.row_hash`,
            sourcePayloadId: sql`excluded.source_payload_id`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${deputados.rowHash} IS DISTINCT FROM excluded.row_hash`,
        })
        .returning({ id: deputados.id });

      const membershipRows = memberships.map((item: DeputadoLegislatura) => ({
        ...item,
        rowHash: canonicalHash(item),
        sourcePayloadId,
      }));
      const changedMemberships = await tx
        .insert(deputadoLegislaturas)
        .values(membershipRows)
        .onConflictDoUpdate({
          target: [
            deputadoLegislaturas.deputadoId,
            deputadoLegislaturas.legislaturaId,
          ],
          set: {
            siglaPartido: sql`excluded.sigla_partido`,
            partidoId: sql`excluded.partido_id`,
            siglaUf: sql`excluded.sigla_uf`,
            email: sql`excluded.email`,
            rowHash: sql`excluded.row_hash`,
            sourcePayloadId: sql`excluded.source_payload_id`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${deputadoLegislaturas.rowHash} IS DISTINCT FROM excluded.row_hash`,
        })
        .returning({ deputadoId: deputadoLegislaturas.deputadoId });

      const changedIds = new Set<number>([
        ...changedDeputies.map((row) => row.id),
        ...changedMemberships.map((row) => row.deputadoId),
      ]);

      return {
        written: changedIds.size,
        unchanged: items.length - changedIds.size,
      };
    });
  }
}
