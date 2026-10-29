import { and, eq, inArray, or, sql } from "drizzle-orm";
import type {
  CsvEnrichmentResult,
  DespesaSyncResult,
  DespesaRepository,
} from "@/application/ports/despesa-repository";
import { DuplicateExpenseNaturalKeyError } from "@/application/errors/duplicate-expense-natural-key-error";
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
    item.valorDocumento,
    item.valorGlosa,
    item.valorLiquido,
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
    const uniqueItems = new Map<string, Despesa>();
    for (const item of items) {
      const key: string = naturalKey(item);
      const existing: Despesa | undefined = uniqueItems.get(key);
      if (
        existing !== undefined &&
        canonicalHash(existing) !== canonicalHash(item)
      ) {
        throw new DuplicateExpenseNaturalKeyError(key);
      }
      uniqueItems.set(key, item);
    }
    const expenses: readonly Despesa[] = [...uniqueItems.values()];
    if (expenses.length === 0) {
      return { written: 0, unchanged: 0, enriched: 0, ambiguous: 0 };
    }
    const scope = expenses[0]!;
    if (
      expenses.some(
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
      const categoryNames = [
        ...new Set(expenses.map((item) => item.tipoDespesa)),
      ];
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
          expenses.map((item) => [
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

      const values = expenses.map((item) => {
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
            despesas.valorDocumento,
            despesas.valorGlosa,
            despesas.valorLiquido,
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

      if (changed.length > 0) {
        await tx
          .update(bilhetesAereosCsv)
          .set({ status: "available", associatedExpenseId: null })
          .where(
            inArray(
              bilhetesAereosCsv.associatedExpenseId,
              changed.map(({ id }) => id),
            ),
          );
      }

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

  async enrichFromBilhetesCsv(
    year?: number,
  ): Promise<Omit<CsvEnrichmentResult, "imported">> {
    return this.db.transaction((tx) =>
      this.applyEnrichment(tx, undefined, year),
    );
  }

  private async applyEnrichment(
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    scope?: Pick<Despesa, "deputadoId" | "legislaturaId" | "ano" | "mes">,
    year?: number,
  ): Promise<Omit<CsvEnrichmentResult, "imported">> {
    const filters = [
      ...(scope === undefined
        ? []
        : [
            and(
              eq(despesas.deputadoId, scope.deputadoId),
              eq(despesas.legislaturaId, scope.legislaturaId),
              eq(despesas.ano, scope.ano),
              eq(despesas.mes, scope.mes),
            ),
          ]),
      ...(year === undefined ? [] : [eq(despesas.ano, year)]),
    ];
    const scopeWhere = filters.length === 0 ? undefined : and(...filters);
    const candidates = await tx
      .select({
        despesaId: despesas.id,
        passageiro: sql<
          string | null
        >`min(NULLIF(${bilhetesAereosCsv.passageiro}, ''))`,
        trecho: sql<
          string | null
        >`min(NULLIF(${bilhetesAereosCsv.trecho}, ''))`,
        ticketIds: sql<
          string[]
        >`json_agg(DISTINCT ${bilhetesAereosCsv.id}::text)`,
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
            eq(bilhetesAereosCsv.status, "available"),
            eq(bilhetesAereosCsv.associatedExpenseId, despesas.id),
          ),
          or(
            sql`${bilhetesAereosCsv.passageiro} <> ''`,
            sql`${bilhetesAereosCsv.trecho} <> ''`,
          ),
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
              (item) =>
                sql`WHEN ${item.despesaId} THEN COALESCE(${item.passageiro}, ${despesas.passageiro})`,
            ),
            sql` `,
          )} ELSE ${despesas.passageiro} END`,
          trecho: sql`CASE ${despesas.id} ${sql.join(
            batch.map(
              (item) =>
                sql`WHEN ${item.despesaId} THEN COALESCE(${item.trecho}, ${despesas.trecho})`,
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
                    ...(item.passageiro === null
                      ? []
                      : [
                          sql`${despesas.passageiro} IS DISTINCT FROM ${item.passageiro}`,
                        ]),
                    ...(item.trecho === null
                      ? []
                      : [
                          sql`${despesas.trecho} IS DISTINCT FROM ${item.trecho}`,
                        ]),
                  ),
                ),
              ),
            ),
          ),
        )
        .returning({ id: despesas.id });
      enriched += changed.length;

      const associations = batch.flatMap((item) =>
        item.ticketIds.map((ticketId) => ({
          ticketId: Number(ticketId),
          expenseId: item.despesaId,
        })),
      );
      const associationBatchSize: number = 1_000;
      for (
        let associationOffset: number = 0;
        associationOffset < associations.length;
        associationOffset += associationBatchSize
      ) {
        const associationBatch = associations.slice(
          associationOffset,
          associationOffset + associationBatchSize,
        );
        const ticketIds = associationBatch.map(({ ticketId }) => ticketId);
        const expenseIds = [
          ...new Set(associationBatch.map(({ expenseId }) => expenseId)),
        ];
        await tx
          .update(bilhetesAereosCsv)
          .set({
            status: "associated",
            associatedExpenseId: sql`CASE ${bilhetesAereosCsv.id} ${sql.join(
              associationBatch.map(
                ({ ticketId, expenseId }) =>
                  sql`WHEN ${ticketId} THEN ${expenseId}`,
              ),
              sql` `,
            )} ELSE ${bilhetesAereosCsv.associatedExpenseId} END`,
          })
          .where(
            and(
              inArray(bilhetesAereosCsv.id, ticketIds),
              or(
                eq(bilhetesAereosCsv.status, "available"),
                inArray(bilhetesAereosCsv.associatedExpenseId, expenseIds),
              ),
            ),
          );
      }
    }

    for (
      let offset: number = 0;
      offset < ambiguousMatches.length;
      offset += batchSize
    ) {
      const batch = ambiguousMatches.slice(offset, offset + batchSize);
      await tx
        .update(bilhetesAereosCsv)
        .set({ status: "available", associatedExpenseId: null })
        .where(
          inArray(
            bilhetesAereosCsv.associatedExpenseId,
            batch.map((item) => item.despesaId),
          ),
        );
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
