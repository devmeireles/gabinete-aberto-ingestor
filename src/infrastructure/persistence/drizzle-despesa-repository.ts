import { and, eq, inArray, or, sql } from "drizzle-orm";
import type {
  CsvEnrichmentResult,
  DespesaSyncResult,
  DespesaRepository,
} from "@/application/ports/despesa-repository";
import type { BilheteAereoCsv, Despesa } from "@/domain/model/despesa";
import { canonicalHash } from "@/shared/canonical-hash";
import type { Database } from "./client";
import {
  bilhetesAereosCsv,
  deputadoLegislaturas,
  despesas,
  fornecedores,
  legislaturas,
  tiposDespesa,
} from "./schema";

function supplierKey(nome: string, cnpjCpf: string): string {
  return JSON.stringify([nome, cnpjCpf]);
}

function naturalKey(item: Despesa): string {
  return JSON.stringify([
    item.deputadoId,
    item.legislaturaId,
    item.ano,
    item.mes,
    item.codDocumento,
    item.codLote,
    item.parcela,
  ]);
}

export class DrizzleDespesaRepository implements DespesaRepository {
  constructor(private readonly db: Database) {}

  async getActiveLegislaturaId(asOf: string): Promise<number> {
    const isCurrent = sql`${legislaturas.dataInicio} <= ${asOf}::date AND (${legislaturas.dataFim} IS NULL OR ${legislaturas.dataFim} >= ${asOf}::date)`;
    await this.db
      .update(legislaturas)
      .set({ legislaturaAtual: isCurrent })
      .where(
        sql`${legislaturas.legislaturaAtual} IS DISTINCT FROM (${isCurrent})`,
      );
    const rows = await this.db
      .select({ id: legislaturas.id })
      .from(legislaturas)
      .where(eq(legislaturas.legislaturaAtual, true));
    if (rows.length !== 1) {
      throw new Error(
        `Esperada uma legislatura vigente em ${asOf}, encontradas: ${rows.length}`,
      );
    }
    return rows[0]!.id;
  }

  async listDeputadoIds(legislaturaId: number): Promise<readonly number[]> {
    const rows = await this.db
      .select({ id: deputadoLegislaturas.deputadoId })
      .from(deputadoLegislaturas)
      .where(eq(deputadoLegislaturas.legislaturaId, legislaturaId))
      .orderBy(deputadoLegislaturas.deputadoId);
    return rows.map(({ id }) => id);
  }

  async upsertMany(
    items: readonly Despesa[],
    sourcePayloadId: number,
  ): Promise<DespesaSyncResult> {
    if (new Set(items.map(naturalKey)).size !== items.length) {
      throw new Error("A página contém despesas com chave natural duplicada");
    }
    if (items.length === 0) {
      return { written: 0, unchanged: 0, enriched: 0, ambiguous: 0 };
    }
    const scope = items[0]!;
    if (
      items.some(
        (item) =>
          item.deputadoId !== scope.deputadoId ||
          item.legislaturaId !== scope.legislaturaId ||
          item.ano !== scope.ano ||
          item.mes !== scope.mes,
      )
    ) {
      throw new Error(
        "Uma página de despesas deve pertencer ao mesmo deputado e período",
      );
    }

    return this.db.transaction(async (tx) => {
      const categoryNames = [...new Set(items.map((item) => item.tipoDespesa))];
      await tx
        .insert(tiposDespesa)
        .values(categoryNames.map((nome) => ({ nome })))
        .onConflictDoNothing();
      const categoryRows = await tx
        .select({ id: tiposDespesa.id, nome: tiposDespesa.nome })
        .from(tiposDespesa)
        .where(inArray(tiposDespesa.nome, categoryNames));
      const categoryIds = new Map(
        categoryRows.map((row) => [row.nome, row.id]),
      );

      const supplierPairs = [
        ...new Map(
          items.map((item) => [
            supplierKey(item.nomeFornecedor, item.cnpjCpfFornecedor),
            {
              nome: item.nomeFornecedor,
              cnpjCpf: item.cnpjCpfFornecedor,
            },
          ]),
        ).values(),
      ];
      await tx.insert(fornecedores).values(supplierPairs).onConflictDoNothing();
      const supplierRows = await tx
        .select({
          id: fornecedores.id,
          nome: fornecedores.nome,
          cnpjCpf: fornecedores.cnpjCpf,
        })
        .from(fornecedores)
        .where(
          or(
            ...supplierPairs.map((supplier) =>
              and(
                eq(fornecedores.nome, supplier.nome),
                eq(fornecedores.cnpjCpf, supplier.cnpjCpf),
              ),
            ),
          ),
        );
      const supplierIds = new Map(
        supplierRows.map((row) => [supplierKey(row.nome, row.cnpjCpf), row.id]),
      );

      const values = items.map((item) => {
        const tipoDespesaId: number | undefined = categoryIds.get(
          item.tipoDespesa,
        );
        const fornecedorId: number | undefined = supplierIds.get(
          supplierKey(item.nomeFornecedor, item.cnpjCpfFornecedor),
        );
        if (tipoDespesaId === undefined || fornecedorId === undefined) {
          throw new Error(
            `Não foi possível resolver tipo/fornecedor da despesa ${item.codDocumento}`,
          );
        }
        return {
          deputadoId: item.deputadoId,
          legislaturaId: item.legislaturaId,
          ano: item.ano,
          mes: item.mes,
          tipoDespesaId,
          codDocumento: item.codDocumento,
          tipoDocumento: item.tipoDocumento,
          codTipoDocumento: item.codTipoDocumento,
          dataDocumento: item.dataDocumento,
          numDocumento: item.numDocumento,
          parcela: item.parcela,
          numRessarcimento: item.numRessarcimento,
          codLote: item.codLote,
          fornecedorId,
          valorDocumento: item.valorDocumento,
          valorGlosa: item.valorGlosa,
          valorLiquido: item.valorLiquido,
          urlDocumento: item.urlDocumento,
          rowHash: canonicalHash(item),
          sourcePayloadId,
        };
      });

      const changed = await tx
        .insert(despesas)
        .values(values)
        .onConflictDoUpdate({
          target: [
            despesas.deputadoId,
            despesas.legislaturaId,
            despesas.ano,
            despesas.mes,
            despesas.codDocumento,
            despesas.codLote,
            despesas.parcela,
          ],
          set: {
            tipoDespesaId: sql`excluded.tipo_despesa_id`,
            tipoDocumento: sql`excluded.tipo_documento`,
            codTipoDocumento: sql`excluded.cod_tipo_documento`,
            dataDocumento: sql`excluded.data_documento`,
            numDocumento: sql`excluded.num_documento`,
            numRessarcimento: sql`excluded.num_ressarcimento`,
            fornecedorId: sql`excluded.fornecedor_id`,
            valorDocumento: sql`excluded.valor_documento`,
            valorGlosa: sql`excluded.valor_glosa`,
            valorLiquido: sql`excluded.valor_liquido`,
            urlDocumento: sql`excluded.url_documento`,
            passageiro: null,
            trecho: null,
            bilheteMatchAmbiguo: false,
            rowHash: sql`excluded.row_hash`,
            sourcePayloadId: sql`excluded.source_payload_id`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${despesas.rowHash} IS DISTINCT FROM excluded.row_hash`,
        })
        .returning({ id: despesas.id });

      const enrichment = await this.applyEnrichment(tx, scope);
      return {
        written: changed.length,
        unchanged: items.length - changed.length,
        ...enrichment,
      };
    });
  }

  async importBilhetesCsv(
    items: readonly BilheteAereoCsv[],
  ): Promise<CsvEnrichmentResult> {
    if (items.length === 0) return { imported: 0, enriched: 0, ambiguous: 0 };

    return this.db.transaction(async (tx) => {
      const imported = await tx
        .insert(bilhetesAereosCsv)
        .values([...items])
        .onConflictDoNothing()
        .returning({ id: bilhetesAereosCsv.id });
      return { imported: imported.length, enriched: 0, ambiguous: 0 };
    });
  }

  async enrichFromBilhetesCsv(): Promise<
    Omit<CsvEnrichmentResult, "imported">
  > {
    return this.db.transaction((tx) => this.applyEnrichment(tx));
  }

  private async applyEnrichment(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    scope?: Pick<Despesa, "deputadoId" | "legislaturaId" | "ano" | "mes">,
  ): Promise<Omit<CsvEnrichmentResult, "imported">> {
    const scopeWhere =
      scope === undefined
        ? undefined
        : and(
            eq(despesas.deputadoId, scope.deputadoId),
            eq(despesas.legislaturaId, scope.legislaturaId),
            eq(despesas.ano, scope.ano),
            eq(despesas.mes, scope.mes),
          );
    const candidates = await tx
      .select({
        despesaId: despesas.id,
        passageiro: sql<string>`min(${bilhetesAereosCsv.passageiro})`,
        trecho: sql<string>`min(${bilhetesAereosCsv.trecho})`,
        distinctRoutes: sql<number>`count(DISTINCT (${bilhetesAereosCsv.passageiro}, ${bilhetesAereosCsv.trecho}))::int`,
      })
      .from(despesas)
      .innerJoin(tiposDespesa, eq(tiposDespesa.id, despesas.tipoDespesaId))
      .innerJoin(fornecedores, eq(fornecedores.id, despesas.fornecedorId))
      .innerJoin(
        bilhetesAereosCsv,
        and(
          eq(bilhetesAereosCsv.deputadoId, despesas.deputadoId),
          eq(bilhetesAereosCsv.legislaturaId, despesas.legislaturaId),
          eq(bilhetesAereosCsv.ano, despesas.ano),
          eq(bilhetesAereosCsv.mes, despesas.mes),
          eq(bilhetesAereosCsv.tipoDespesa, tiposDespesa.nome),
          eq(bilhetesAereosCsv.codTipoDocumento, despesas.codTipoDocumento),
          eq(bilhetesAereosCsv.codDocumento, despesas.codDocumento),
          eq(bilhetesAereosCsv.dataDocumento, despesas.dataDocumento!),
          eq(bilhetesAereosCsv.numDocumento, despesas.numDocumento),
          eq(bilhetesAereosCsv.parcela, despesas.parcela),
          eq(bilhetesAereosCsv.codLote, despesas.codLote),
          eq(bilhetesAereosCsv.valorDocumento, despesas.valorDocumento),
          or(
            eq(bilhetesAereosCsv.cnpjCpfFornecedor, ""),
            eq(fornecedores.cnpjCpf, ""),
            eq(bilhetesAereosCsv.cnpjCpfFornecedor, fornecedores.cnpjCpf),
          ),
        ),
      )
      .where(scopeWhere)
      .groupBy(despesas.id)
      .having(
        sql`count(DISTINCT (${bilhetesAereosCsv.passageiro}, ${bilhetesAereosCsv.trecho})) > 0`,
      );
    const ambiguous: number = candidates.filter(
      (candidate) => candidate.distinctRoutes > 1,
    ).length;
    const uniqueMatches = candidates.filter(
      (candidate) => candidate.distinctRoutes === 1,
    );
    const ambiguousMatches = candidates.filter(
      (candidate) => candidate.distinctRoutes > 1,
    );
    let enriched: number = 0;
    const batchSize: number = 100;
    for (
      let offset: number = 0;
      offset < uniqueMatches.length;
      offset += batchSize
    ) {
      const batch = uniqueMatches.slice(offset, offset + batchSize);
      const changed = await tx
        .update(despesas)
        .set({
          bilheteMatchAmbiguo: false,
          passageiro: sql`CASE ${despesas.id} ${sql.join(
            batch.map(
              (item) => sql`WHEN ${item.despesaId} THEN ${item.passageiro}`,
            ),
            sql` `,
          )} ELSE ${despesas.passageiro} END`,
          trecho: sql`CASE ${despesas.id} ${sql.join(
            batch.map(
              (item) => sql`WHEN ${item.despesaId} THEN ${item.trecho}`,
            ),
            sql` `,
          )} ELSE ${despesas.trecho} END`,
        })
        .where(
          and(
            inArray(
              despesas.id,
              batch.map((item) => item.despesaId),
            ),
            or(
              ...batch.map((item) =>
                and(
                  eq(despesas.id, item.despesaId),
                  or(
                    eq(despesas.bilheteMatchAmbiguo, true),
                    sql`${despesas.passageiro} IS DISTINCT FROM ${item.passageiro}`,
                    sql`${despesas.trecho} IS DISTINCT FROM ${item.trecho}`,
                  ),
                ),
              ),
            ),
          ),
        )
        .returning({ id: despesas.id });
      enriched += changed.length;
    }

    for (
      let offset: number = 0;
      offset < ambiguousMatches.length;
      offset += batchSize
    ) {
      const batch = ambiguousMatches.slice(offset, offset + batchSize);
      await tx
        .update(despesas)
        .set({
          passageiro: null,
          trecho: null,
          bilheteMatchAmbiguo: true,
        })
        .where(
          inArray(
            despesas.id,
            batch.map((item) => item.despesaId),
          ),
        );
    }

    return { enriched, ambiguous };
  }
}
