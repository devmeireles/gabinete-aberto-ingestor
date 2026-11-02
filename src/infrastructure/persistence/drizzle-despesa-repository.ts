import { and, eq, inArray, or, sql } from "drizzle-orm";
import type {
  CsvEnrichmentResult,
  DespesaSyncResult,
  DespesaRepository,
  RejectedDespesa,
  RejectedDespesaPayload,
} from "@/application/ports/despesa-repository";
import type { BilheteAereoCsv, Despesa } from "@/domain/model/despesa";
import { canonicalHash } from "@/shared/canonical-hash";
import type { Database } from "./client";
import {
  bilhetesAereosCsv,
  deputadoLegislaturas,
  deputados,
  despesas,
  despesaConflicts,
  fornecedores,
  legislaturas,
  tiposDespesa,
} from "./schema";

function supplierKey(nome: string, cnpjCpf: string): string {
  return JSON.stringify([nome, cnpjCpf]);
}

function naturalKey(item: Despesa | RejectedDespesaPayload): string {
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
    item.numDocumento,
    item.dataDocumento,
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
    rejectedItems: readonly RejectedDespesa[] = [],
  ): Promise<DespesaSyncResult> {
    if (items.length === 0 && rejectedItems.length === 0) {
      return {
        written: 0,
        unchanged: 0,
        enriched: 0,
        ambiguous: 0,
        conflicted: 0,
        removed: 0,
      };
    }
    const scope = items[0] ?? rejectedItems[0]!.payload;
    if (
      [...items, ...rejectedItems.map(({ payload }) => payload)].some(
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

    const uniqueItems = new Map<string, Despesa>();
    const conflictingKeys = new Set<string>();
    for (const item of items) {
      const key = naturalKey(item);
      const existing = uniqueItems.get(key);
      if (
        existing !== undefined &&
        canonicalHash(existing) !== canonicalHash(item)
      ) {
        conflictingKeys.add(key);
      }
      uniqueItems.set(key, item);
    }
    // Quarantine every variant of a conflicting group; never pick a winner.
    const conflicts = items.filter((item) =>
      conflictingKeys.has(naturalKey(item)),
    );
    const expenses = [...uniqueItems.entries()]
      .filter(([key]) => !conflictingKeys.has(key))
      .map(([, item]) => item);
    const quarantine = [
      ...conflicts.map((payload) => ({
        payload,
        reason: "same_natural_key_different_content",
      })),
      ...rejectedItems,
    ];
    const conflicted = quarantine.length;

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(712029, 1)`);
      if (quarantine.length > 0) {
        await tx
          .insert(despesaConflicts)
          .values(
            quarantine.map(({ payload, reason }) => ({
              naturalKey: naturalKey(payload),
              rowHash: canonicalHash(payload),
              payload,
              reason,
            })),
          )
          .onConflictDoNothing();
      }
      if (expenses.length === 0) {
        return {
          written: 0,
          unchanged: 0,
          enriched: 0,
          ambiguous: 0,
          conflicted,
          removed: 0,
        };
      }
      const categoryNames = [
        ...new Set(expenses.map((item) => item.tipoDespesa)),
      ];
      const categoryRows = await tx
        .select({ id: tiposDespesa.id, nome: tiposDespesa.nome })
        .from(tiposDespesa)
        .where(inArray(tiposDespesa.nome, categoryNames));
      const categoryIds = new Map(
        categoryRows.map((row) => [row.nome, row.id]),
      );
      const missingCategories = categoryNames.filter(
        (nome) => !categoryIds.has(nome),
      );
      if (missingCategories.length > 0) {
        const inserted = await tx
          .insert(tiposDespesa)
          .values(missingCategories.map((nome) => ({ nome })))
          .onConflictDoNothing()
          .returning({ id: tiposDespesa.id, nome: tiposDespesa.nome });
        inserted.forEach((row) => categoryIds.set(row.nome, row.id));
        // A concurrent page may have won an insert. Resolve only the IDs that
        // ON CONFLICT could not RETURN, using the next READ COMMITTED snapshot.
        const unresolved = missingCategories.filter(
          (nome) => !categoryIds.has(nome),
        );
        if (unresolved.length > 0) {
          const concurrent = await tx
            .select({ id: tiposDespesa.id, nome: tiposDespesa.nome })
            .from(tiposDespesa)
            .where(inArray(tiposDespesa.nome, unresolved));
          concurrent.forEach((row) => categoryIds.set(row.nome, row.id));
        }
      }

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

      const missingSuppliers = supplierPairs.filter(
        (supplier) =>
          !supplierIds.has(supplierKey(supplier.nome, supplier.cnpjCpf)),
      );
      if (missingSuppliers.length > 0) {
        const inserted = await tx
          .insert(fornecedores)
          .values(missingSuppliers)
          .onConflictDoNothing()
          .returning({
            id: fornecedores.id,
            nome: fornecedores.nome,
            cnpjCpf: fornecedores.cnpjCpf,
          });
        inserted.forEach((row) =>
          supplierIds.set(supplierKey(row.nome, row.cnpjCpf), row.id),
        );
        const unresolved = missingSuppliers.filter(
          (supplier) =>
            !supplierIds.has(supplierKey(supplier.nome, supplier.cnpjCpf)),
        );
        if (unresolved.length > 0) {
          const concurrent = await tx
            .select({
              id: fornecedores.id,
              nome: fornecedores.nome,
              cnpjCpf: fornecedores.cnpjCpf,
            })
            .from(fornecedores)
            .where(
              or(
                ...unresolved.map((supplier) =>
                  and(
                    eq(fornecedores.nome, supplier.nome),
                    eq(fornecedores.cnpjCpf, supplier.cnpjCpf),
                  ),
                ),
              ),
            );
          concurrent.forEach((row) =>
            supplierIds.set(supplierKey(row.nome, row.cnpjCpf), row.id),
          );
        }
      }

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
        };
      });

      const sameTicketIdentity = sql`(
        ${despesas.tipoDespesaId} IS NOT DISTINCT FROM excluded.tipo_despesa_id
        AND ${despesas.codTipoDocumento} IS NOT DISTINCT FROM excluded.cod_tipo_documento
        AND ${despesas.fornecedorId} IS NOT DISTINCT FROM excluded.fornecedor_id
      )`;
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
            despesas.numDocumento,
            despesas.dataDocumento,
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
            passageiro: sql`CASE WHEN ${sameTicketIdentity} THEN ${despesas.passageiro} ELSE NULL END`,
            trecho: sql`CASE WHEN ${sameTicketIdentity} THEN ${despesas.trecho} ELSE NULL END`,
            bilheteMatchAmbiguo: sql`CASE WHEN ${sameTicketIdentity} THEN ${despesas.bilheteMatchAmbiguo} ELSE false END`,
            rowHash: sql`excluded.row_hash`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`${despesas.rowHash} IS DISTINCT FROM excluded.row_hash`,
        })
        .returning({ id: despesas.id });

      const enrichment = await this.applyEnrichment(tx, scope);
      return {
        written: changed.length,
        unchanged: items.length - conflicts.length - changed.length,
        conflicted,
        ...enrichment,
      };
    });
  }

  async importBilhetesCsv(
    items: readonly BilheteAereoCsv[],
  ): Promise<CsvEnrichmentResult> {
    if (items.length === 0)
      return { imported: 0, enriched: 0, ambiguous: 0, removed: 0 };

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(712029, 1)`);
      const imported = await tx
        .insert(bilhetesAereosCsv)
        .values(
          items.map((item) => {
            const row = { ...item };
            delete row.ceapDeputadoId;
            return row;
          }),
        )
        .onConflictDoNothing()
        .returning({ id: bilhetesAereosCsv.id });
      // Reimported source rows identify both the API and the former CEAP ID.
      // Delete a legacy row only after its correctly identified equivalent is
      // stored, and only if all business fields agree. Unrelated rows stay.
      const legacy = items.filter(
        (item) =>
          item.ceapDeputadoId !== undefined &&
          item.ceapDeputadoId !== item.deputadoId,
      );
      let removed = 0;
      if (legacy.length > 0) {
        const deleted = await tx
          .delete(bilhetesAereosCsv)
          .where(
            or(
              ...legacy.map((item) =>
                and(
                  eq(bilhetesAereosCsv.deputadoId, item.ceapDeputadoId!),
                  sql`EXISTS (
                    SELECT 1 FROM bilhetes_aereos_csv corrected
                    WHERE corrected.deputado_id = ${item.deputadoId}
                    AND (corrected.legislatura_id, corrected.ano, corrected.mes,
                      corrected.tipo_despesa, corrected.cod_documento, corrected.cod_tipo_documento,
                      corrected.data_documento, corrected.num_documento, corrected.parcela,
                      corrected.cod_lote, corrected.cnpj_cpf_fornecedor, corrected.valor_documento,
                      corrected.passageiro, corrected.trecho)
                    = (${bilhetesAereosCsv.legislaturaId}, ${bilhetesAereosCsv.ano}, ${bilhetesAereosCsv.mes},
                      ${bilhetesAereosCsv.tipoDespesa}, ${bilhetesAereosCsv.codDocumento}, ${bilhetesAereosCsv.codTipoDocumento},
                      ${bilhetesAereosCsv.dataDocumento}, ${bilhetesAereosCsv.numDocumento}, ${bilhetesAereosCsv.parcela},
                      ${bilhetesAereosCsv.codLote}, ${bilhetesAereosCsv.cnpjCpfFornecedor}, ${bilhetesAereosCsv.valorDocumento},
                      ${bilhetesAereosCsv.passageiro}, ${bilhetesAereosCsv.trecho})
                  )`,
                  sql`NOT EXISTS (SELECT 1 FROM ${deputados} WHERE ${deputados.id} = ${bilhetesAereosCsv.deputadoId})`,
                  eq(bilhetesAereosCsv.arquivo, item.arquivo),
                  eq(bilhetesAereosCsv.linha, item.linha),
                  eq(bilhetesAereosCsv.legislaturaId, item.legislaturaId),
                  eq(bilhetesAereosCsv.ano, item.ano),
                  eq(bilhetesAereosCsv.mes, item.mes),
                  eq(bilhetesAereosCsv.tipoDespesa, item.tipoDespesa),
                  eq(bilhetesAereosCsv.codDocumento, item.codDocumento),
                  eq(bilhetesAereosCsv.codTipoDocumento, item.codTipoDocumento),
                  eq(bilhetesAereosCsv.dataDocumento, item.dataDocumento),
                  eq(bilhetesAereosCsv.numDocumento, item.numDocumento),
                  eq(bilhetesAereosCsv.parcela, item.parcela),
                  eq(bilhetesAereosCsv.codLote, item.codLote),
                  eq(
                    bilhetesAereosCsv.cnpjCpfFornecedor,
                    item.cnpjCpfFornecedor,
                  ),
                  eq(bilhetesAereosCsv.valorDocumento, item.valorDocumento),
                  eq(bilhetesAereosCsv.passageiro, item.passageiro),
                  eq(bilhetesAereosCsv.trecho, item.trecho),
                ),
              ),
            ),
          )
          .returning({ id: bilhetesAereosCsv.id });
        removed = deleted.length;
      }
      return { imported: imported.length, enriched: 0, ambiguous: 0, removed };
    });
  }

  async getBilheteSyncStats(year: number) {
    const rows = await this.db
      .select({
        pendingTickets: sql<number>`count(*)::int`,
        ticketsWithKnownDeputy: sql<number>`count(${deputados.id})::int`,
        ticketsWithPassengerOrRoute: sql<number>`count(*) FILTER (WHERE ${bilhetesAereosCsv.passageiro} <> '' OR ${bilhetesAereosCsv.trecho} <> '')::int`,
        ticketsWithoutDocumentCode: sql<number>`count(*) FILTER (WHERE ${bilhetesAereosCsv.codDocumento} = '')::int`,
      })
      .from(bilhetesAereosCsv)
      .leftJoin(deputados, eq(deputados.id, bilhetesAereosCsv.deputadoId))
      .where(eq(bilhetesAereosCsv.ano, year));
    return rows[0]!;
  }

  async enrichFromBilhetesCsv(
    year?: number,
  ): Promise<Omit<CsvEnrichmentResult, "imported">> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(712029, 1)`);
      return this.applyEnrichment(tx, undefined, year);
    });
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
    const matches = tx
      .select({
        despesaId: sql<number>`${despesas.id}`.as("despesa_id"),
        ticketId: sql<number>`${bilhetesAereosCsv.id}`.as("ticket_id"),
        passageiro: bilhetesAereosCsv.passageiro,
        trecho: bilhetesAereosCsv.trecho,
        targets:
          sql<number>`count(*) OVER (PARTITION BY ${bilhetesAereosCsv.id})::int`.as(
            "targets",
          ),
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
      .as("ticket_matches");
    const candidates = await tx
      .select({
        despesaId: matches.despesaId,
        passageiro: sql<string | null>`min(NULLIF(${matches.passageiro}, ''))`,
        trecho: sql<string | null>`min(NULLIF(${matches.trecho}, ''))`,
        ticketIds: sql<string[]>`json_agg(DISTINCT ${matches.ticketId}::text)`,
        ambiguous: sql<boolean>`bool_or(${matches.targets} > 1)
        OR count(DISTINCT (${matches.passageiro}, ${matches.trecho})) > 1
        OR ${despesas.bilheteMatchAmbiguo}
        OR (
          (${despesas.passageiro} IS NOT NULL OR ${despesas.trecho} IS NOT NULL)
          AND bool_or((${matches.passageiro}, ${matches.trecho}) IS DISTINCT FROM
            (COALESCE(${despesas.passageiro}, ''), COALESCE(${despesas.trecho}, '')))
        )`,
      })
      .from(matches)
      .innerJoin(despesas, eq(despesas.id, matches.despesaId))
      .groupBy(matches.despesaId, despesas.id);
    const uniqueMatches = candidates.filter(
      (candidate) => !candidate.ambiguous,
    );
    const ambiguousMatches = candidates.filter(
      (candidate) => candidate.ambiguous,
    );
    const ambiguous = ambiguousMatches.length;
    let removed = 0;
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

      // Expense changes and staging-row deletion commit atomically. Tickets
      // with multiple candidate expenses or routes never reach this branch.
      const ticketIds = [
        ...new Set(batch.flatMap((item) => item.ticketIds.map(Number))),
      ];
      for (
        let ticketOffset = 0;
        ticketOffset < ticketIds.length;
        ticketOffset += 1_000
      ) {
        const deleted = await tx
          .delete(bilhetesAereosCsv)
          .where(
            inArray(
              bilhetesAereosCsv.id,
              ticketIds.slice(ticketOffset, ticketOffset + 1_000),
            ),
          )
          .returning({ id: bilhetesAereosCsv.id });
        removed += deleted.length;
      }
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
          and(
            inArray(
              despesas.id,
              batch.map((item) => item.despesaId),
            ),
            or(
              eq(despesas.bilheteMatchAmbiguo, false),
              sql`${despesas.passageiro} IS NOT NULL`,
              sql`${despesas.trecho} IS NOT NULL`,
            ),
          ),
        );
    }

    return { enriched, ambiguous, removed };
  }
}
