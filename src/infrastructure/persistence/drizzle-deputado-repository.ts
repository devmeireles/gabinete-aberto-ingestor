import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  DeputadoPageSnapshot,
  DeputadoRepository,
} from "@/application/ports/deputado-repository";
import type { UpsertResult } from "@/application/ports/legislatura-repository";
import type { Deputado, DeputadoDetalhe } from "@/domain/model/deputado";
import { canonicalHash } from "@/shared/canonical-hash";
import type { Database } from "./client";
import {
  deputadoLegislaturas,
  deputadoPartidoVigencias,
  deputadoDetalhes,
  deputados,
} from "./schema";

export class DrizzleDeputadoRepository implements DeputadoRepository {
  constructor(private readonly db: Database) {}

  async listIds(): Promise<readonly number[]> {
    const rows = await this.db
      .select({ id: deputados.id })
      .from(deputados)
      .orderBy(asc(deputados.id));
    return rows.map(({ id }) => id);
  }

  async syncPage(snapshot: DeputadoPageSnapshot): Promise<UpsertResult> {
    const { deputados: items, legislaturas: memberships } = snapshot;
    if (items.length !== memberships.length) {
      throw new Error("Cada deputado deve ter uma associação de legislatura");
    }
    if (
      items.some((item, index) => item.id !== memberships[index].deputadoId)
    ) {
      throw new Error("A associação precisa referenciar o deputado recebido");
    }
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      throw new Error("A página contém deputados duplicados após normalização");
    }
    const deputadoIds: Set<number> = new Set(items.map((item) => item.id));
    if (
      snapshot.historicos.length !== items.length ||
      new Set(snapshot.historicos.map((item) => item.deputadoId)).size !==
        snapshot.historicos.length ||
      snapshot.historicos.some(
        (history) => !deputadoIds.has(history.deputadoId),
      )
    ) {
      throw new Error(
        "Cada deputado da página precisa ter seu histórico partidário consultado",
      );
    }
    if (items.length === 0 && snapshot.historicos.length === 0) {
      return { written: 0, unchanged: 0 };
    }

    return this.db.transaction(async (tx) => {
      const deputyRows = items.map((item: Deputado) => ({
        ...item,
        rowHash: canonicalHash(item),
        sourcePayloadId: snapshot.sourcePayloadId,
      }));
      const changedDeputies =
        deputyRows.length === 0
          ? []
          : await tx
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

      const membershipRows = memberships.map((item) => ({
        ...item,
        rowHash: canonicalHash(item),
        sourcePayloadId: snapshot.sourcePayloadId,
      }));
      const changedMemberships =
        membershipRows.length === 0
          ? []
          : await tx
              .insert(deputadoLegislaturas)
              .values(membershipRows)
              .onConflictDoUpdate({
                target: [
                  deputadoLegislaturas.deputadoId,
                  deputadoLegislaturas.legislaturaId,
                ],
                set: {
                  siglaUf: sql`excluded.sigla_uf`,
                  email: sql`excluded.email`,
                  rowHash: sql`excluded.row_hash`,
                  sourcePayloadId: sql`excluded.source_payload_id`,
                  updatedAt: sql`now()`,
                },
                setWhere: sql`${deputadoLegislaturas.rowHash} IS DISTINCT FROM excluded.row_hash`,
              })
              .returning({ deputadoId: deputadoLegislaturas.deputadoId });

      const historicalDeputyIds: number[] = [
        ...new Set(snapshot.historicos.map((item) => item.deputadoId)),
      ];
      for (const history of snapshot.historicos) {
        const membership = memberships.find(
          (item) => item.deputadoId === history.deputadoId,
        );
        if (
          membership === undefined ||
          membership.legislaturaId !== history.legislaturaId ||
          history.vigencias.some(
            (item) =>
              item.deputadoId !== history.deputadoId ||
              item.legislaturaId !== history.legislaturaId,
          )
        ) {
          throw new Error(
            `Histórico partidário inconsistente para o deputado ${history.deputadoId}`,
          );
        }
      }

      if (historicalDeputyIds.length > 0) {
        const legislaturaId: number = snapshot.historicos[0]!.legislaturaId;
        if (
          snapshot.historicos.some(
            (item) => item.legislaturaId !== legislaturaId,
          )
        ) {
          throw new Error(
            "Uma página não pode sincronizar históricos de legislaturas diferentes",
          );
        }
        await tx
          .delete(deputadoPartidoVigencias)
          .where(
            and(
              eq(deputadoPartidoVigencias.legislaturaId, legislaturaId),
              inArray(deputadoPartidoVigencias.deputadoId, historicalDeputyIds),
            ),
          );

        const historyRows = snapshot.historicos.flatMap((history) =>
          history.vigencias.map((item) => ({
            ...item,
            rowHash: canonicalHash(item),
            sourcePayloadId: history.sourcePayloadId,
          })),
        );
        if (historyRows.length > 0) {
          await tx.insert(deputadoPartidoVigencias).values(historyRows);
        }
      }

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

  async upsertDetalhe(
    detalhe: DeputadoDetalhe,
    sourcePayloadId: number,
  ): Promise<void> {
    const { deputadoId, gabinete, ...fields } = detalhe;
    const row = {
      deputadoId,
      ...fields,
      gabineteNome: gabinete.nome,
      gabinetePredio: gabinete.predio,
      gabineteSala: gabinete.sala,
      gabineteAndar: gabinete.andar,
      gabineteTelefone: gabinete.telefone,
      gabineteEmail: gabinete.email,
      rowHash: canonicalHash(detalhe),
      sourcePayloadId,
    };

    await this.db
      .insert(deputadoDetalhes)
      .values(row)
      .onConflictDoUpdate({
        target: deputadoDetalhes.deputadoId,
        set: {
          nomeCivil: sql`excluded.nome_civil`,
          cpf: sql`excluded.cpf`,
          sexo: sql`excluded.sexo`,
          urlWebsite: sql`excluded.url_website`,
          redesSociais: sql`excluded.redes_sociais`,
          dataNascimento: sql`excluded.data_nascimento`,
          dataFalecimento: sql`excluded.data_falecimento`,
          ufNascimento: sql`excluded.uf_nascimento`,
          municipioNascimento: sql`excluded.municipio_nascimento`,
          escolaridade: sql`excluded.escolaridade`,
          statusLegislaturaId: sql`excluded.status_legislatura_id`,
          statusNome: sql`excluded.status_nome`,
          statusUri: sql`excluded.status_uri`,
          nomeEleitoral: sql`excluded.nome_eleitoral`,
          siglaPartido: sql`excluded.sigla_partido`,
          uriPartido: sql`excluded.uri_partido`,
          siglaUf: sql`excluded.sigla_uf`,
          urlFoto: sql`excluded.url_foto`,
          email: sql`excluded.email`,
          dataStatus: sql`excluded.data_status`,
          situacao: sql`excluded.situacao`,
          condicaoEleitoral: sql`excluded.condicao_eleitoral`,
          descricaoStatus: sql`excluded.descricao_status`,
          gabineteNome: sql`excluded.gabinete_nome`,
          gabinetePredio: sql`excluded.gabinete_predio`,
          gabineteSala: sql`excluded.gabinete_sala`,
          gabineteAndar: sql`excluded.gabinete_andar`,
          gabineteTelefone: sql`excluded.gabinete_telefone`,
          gabineteEmail: sql`excluded.gabinete_email`,
          rowHash: sql`excluded.row_hash`,
          sourcePayloadId: sql`excluded.source_payload_id`,
          updatedAt: sql`CASE
            WHEN ${deputadoDetalhes.rowHash} IS DISTINCT FROM excluded.row_hash
              THEN now()
            ELSE ${deputadoDetalhes.updatedAt}
          END`,
          lastFetchedAt: sql`now()`,
        },
      });
  }
}
