import { asc, sql } from "drizzle-orm";
import type { PartidoRepository } from "@/application/ports/partido-repository";
import type { UpsertResult } from "@/application/ports/legislatura-repository";
import type {
  Partido,
  PartidoDetalhe,
  PartidoLegislatura,
} from "@/domain/model/partido";
import { canonicalHash } from "@/shared/canonical-hash";
import type { Database } from "./client";
import { partidoDetalhes, partidoLegislaturas, partidos } from "./schema";

export class DrizzlePartidoRepository implements PartidoRepository {
  constructor(private readonly db: Database) {}

  async listIds(): Promise<readonly number[]> {
    const rows = await this.db
      .select({ id: partidos.id })
      .from(partidos)
      .orderBy(asc(partidos.id));
    return rows.map(({ id }) => id);
  }

  async upsertMany(
    items: readonly Partido[],
    memberships: readonly PartidoLegislatura[],
    sourcePayloadId: number,
  ): Promise<UpsertResult> {
    if (items.length !== memberships.length) {
      throw new Error("Cada partido deve ter uma associação de legislatura");
    }
    if (items.some((item, index) => item.id !== memberships[index].partidoId)) {
      throw new Error("A associação precisa referenciar o partido recebido");
    }
    if (items.length === 0) {
      return { written: 0, unchanged: 0 };
    }

    return this.db.transaction(async (tx) => {
      const partyRows = items.map((item: Partido) => ({
        ...item,
        rowHash: canonicalHash(item),
        sourcePayloadId,
      }));
      const changedParties = await tx
        .insert(partidos)
        .values(partyRows)
        .onConflictDoUpdate({
          target: partidos.id,
          set: {
            sigla: sql`excluded.sigla`,
            nome: sql`excluded.nome`,
            uri: sql`excluded.uri`,
            rowHash: sql`excluded.row_hash`,
            sourcePayloadId: sql`excluded.source_payload_id`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${partidos.rowHash} IS DISTINCT FROM excluded.row_hash`,
        })
        .returning({ id: partidos.id });

      const membershipRows = memberships.map((item: PartidoLegislatura) => ({
        ...item,
        rowHash: canonicalHash(item),
        sourcePayloadId,
      }));
      const changedMemberships = await tx
        .insert(partidoLegislaturas)
        .values(membershipRows)
        .onConflictDoUpdate({
          target: [
            partidoLegislaturas.partidoId,
            partidoLegislaturas.legislaturaId,
          ],
          set: {
            rowHash: sql`excluded.row_hash`,
            sourcePayloadId: sql`excluded.source_payload_id`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${partidoLegislaturas.rowHash} IS DISTINCT FROM excluded.row_hash`,
        })
        .returning({ partidoId: partidoLegislaturas.partidoId });

      const changedIds = new Set<number>([
        ...changedParties.map((row) => row.id),
        ...changedMemberships.map((row) => row.partidoId),
      ]);
      return {
        written: changedIds.size,
        unchanged: items.length - changedIds.size,
      };
    });
  }

  async upsertDetalhe(
    detalhe: PartidoDetalhe,
    sourcePayloadId: number,
  ): Promise<void> {
    const { partidoId, lider, ...fields } = detalhe;
    const row = {
      partidoId,
      ...fields,
      liderUri: lider.uri,
      liderNome: lider.nome,
      liderSiglaPartido: lider.siglaPartido,
      liderUriPartido: lider.uriPartido,
      liderUf: lider.uf,
      liderLegislaturaId: lider.legislaturaId,
      liderUrlFoto: lider.urlFoto,
      rowHash: canonicalHash(detalhe),
      sourcePayloadId,
    };

    await this.db
      .insert(partidoDetalhes)
      .values(row)
      .onConflictDoUpdate({
        target: partidoDetalhes.partidoId,
        set: {
          statusData: sql`excluded.status_data`,
          statusLegislaturaId: sql`excluded.status_legislatura_id`,
          situacao: sql`excluded.situacao`,
          totalPosse: sql`excluded.total_posse`,
          totalMembros: sql`excluded.total_membros`,
          uriMembros: sql`excluded.uri_membros`,
          liderUri: sql`excluded.lider_uri`,
          liderNome: sql`excluded.lider_nome`,
          liderSiglaPartido: sql`excluded.lider_sigla_partido`,
          liderUriPartido: sql`excluded.lider_uri_partido`,
          liderUf: sql`excluded.lider_uf`,
          liderLegislaturaId: sql`excluded.lider_legislatura_id`,
          liderUrlFoto: sql`excluded.lider_url_foto`,
          numeroEleitoral: sql`excluded.numero_eleitoral`,
          urlLogo: sql`excluded.url_logo`,
          urlWebSite: sql`excluded.url_website`,
          urlFacebook: sql`excluded.url_facebook`,
          rowHash: sql`excluded.row_hash`,
          sourcePayloadId: sql`excluded.source_payload_id`,
          updatedAt: sql`CASE
            WHEN ${partidoDetalhes.rowHash} IS DISTINCT FROM excluded.row_hash
              THEN now()
            ELSE ${partidoDetalhes.updatedAt}
          END`,
          lastFetchedAt: sql`now()`,
        },
      });
  }
}
