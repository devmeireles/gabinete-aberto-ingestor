import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * CAMADA RAW
 *
 * Guarda o JSON bruto exatamente como a API devolveu. Por quê: auditoria
 * (veracidade) e reprocessamento sem bater na API de novo.
 *
 * Dedupe por (request_key, content_hash): se a resposta não mudou, só
 * atualizamos `last_seen_at`. Se mudou, nasce uma nova linha, e o histórico
 * de alterações da fonte fica preservado.
 */
export const rawPayloads = pgTable(
  "raw_payloads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Endpoint + query canônica ordenada, ex.: "deputados?idLegislatura=57&pagina=1" */
    requestKey: text("request_key").notNull(),
    /** SHA-256 hex do corpo canônico. */
    contentHash: char("content_hash", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull(),
    firstFetchedAt: timestamp("first_fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("raw_payloads_key_hash_uq").on(t.requestKey, t.contentHash),
  ],
);

export const crawlerRuns = pgTable(
  "crawler_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    functionId: text("function_id").notNull(),
    runId: text("run_id").notNull(),
    eventName: text("event_name").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("crawler_runs_function_run_uq").on(t.functionId, t.runId),
    index("crawler_runs_status_started_idx").on(t.status, t.startedAt),
    check(
      "crawler_runs_status_check",
      sql`${t.status} IN ('running', 'completed', 'failed')`,
    ),
    check("crawler_runs_attempt_check", sql`${t.attempt} > 0`),
  ],
);

/**
 * CAMADA NORMALIZADA
 *
 * Toda linha carrega:
 *  - row_hash: hash dos campos de negócio. O upsert só escreve se mudou.
 *  - source_payload_id: de qual resposta bruta veio (rastreabilidade).
 */

export const legislaturas = pgTable("legislaturas", {
  /** O próprio número da legislatura (sequencial desde a primeira). */
  id: integer("id").primaryKey(),
  uri: text("uri").notNull(),
  dataInicio: date("data_inicio", { mode: "string" }).notNull(),
  dataFim: date("data_fim", { mode: "string" }),
  legislaturaAtual: boolean("legislatura_atual").notNull().default(false),
  rowHash: char("row_hash", { length: 64 }).notNull(),
  sourcePayloadId: bigint("source_payload_id", { mode: "number" }).references(
    () => rawPayloads.id,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * PK = id da API, NUNCA a sigla: partidos diferentes reutilizam a mesma
 * sigla em legislaturas diferentes.
 */
export const partidos = pgTable(
  "partidos",
  {
    id: integer("id").primaryKey(),
    sigla: text("sigla").notNull(),
    nome: text("nome").notNull(),
    uri: text("uri").notNull(),
    rowHash: char("row_hash", { length: 64 }).notNull(),
    sourcePayloadId: bigint("source_payload_id", { mode: "number" }).references(
      () => rawPayloads.id,
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("partidos_sigla_idx").on(t.sigla)],
);

export const partidoLegislaturas = pgTable(
  "partido_legislaturas",
  {
    partidoId: integer("partido_id")
      .notNull()
      .references(() => partidos.id),
    legislaturaId: integer("legislatura_id")
      .notNull()
      .references(() => legislaturas.id),
    rowHash: char("row_hash", { length: 64 }).notNull(),
    sourcePayloadId: bigint("source_payload_id", { mode: "number" }).references(
      () => rawPayloads.id,
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.partidoId, t.legislaturaId] })],
);

/** Identidade estável do deputado (o que não muda entre legislaturas). */
export const deputados = pgTable("deputados", {
  id: integer("id").primaryKey(),
  nome: text("nome").notNull(),
  uri: text("uri").notNull(),
  urlFoto: text("url_foto"),
  rowHash: char("row_hash", { length: 64 }).notNull(),
  sourcePayloadId: bigint("source_payload_id", { mode: "number" }).references(
    () => rawPayloads.id,
  ),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Contexto temporal do mandato. A filiação partidária tem vigências próprias
 * em deputado_partido_vigencias, pois pode mudar durante a legislatura.
 */
export const deputadoLegislaturas = pgTable(
  "deputado_legislaturas",
  {
    deputadoId: integer("deputado_id")
      .notNull()
      .references(() => deputados.id),
    legislaturaId: integer("legislatura_id")
      .notNull()
      .references(() => legislaturas.id),
    siglaUf: char("sigla_uf", { length: 2 }),
    email: text("email"),
    rowHash: char("row_hash", { length: 64 }).notNull(),
    sourcePayloadId: bigint("source_payload_id", { mode: "number" }).references(
      () => rawPayloads.id,
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deputadoId, t.legislaturaId] })],
);

/**
 * Histórico de filiação partidária: cada linha representa uma vigência dentro
 * da legislatura. data_inicio nula só é permitida no backfill legado, quando a
 * fonte anterior não guardava a data exata da mudança.
 */
export const deputadoPartidoVigencias = pgTable(
  "deputado_partido_vigencias",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deputadoId: integer("deputado_id").notNull(),
    legislaturaId: integer("legislatura_id").notNull(),
    partidoId: integer("partido_id"),
    dataInicio: timestamp("data_inicio", {
      withTimezone: false,
      mode: "string",
    }),
    dataFim: timestamp("data_fim", { withTimezone: false, mode: "string" }),
    rowHash: char("row_hash", { length: 64 }).notNull(),
    sourcePayloadId: bigint("source_payload_id", { mode: "number" }).references(
      () => rawPayloads.id,
    ),
  },
  (t) => [
    foreignKey({
      name: "deputado_partido_vigencias_deputado_legislatura_fk",
      columns: [t.deputadoId, t.legislaturaId],
      foreignColumns: [
        deputadoLegislaturas.deputadoId,
        deputadoLegislaturas.legislaturaId,
      ],
    }),
    foreignKey({
      name: "deputado_partido_vigencias_partido_legislatura_fk",
      columns: [t.partidoId, t.legislaturaId],
      foreignColumns: [
        partidoLegislaturas.partidoId,
        partidoLegislaturas.legislaturaId,
      ],
    }),
    index("deputado_partido_vigencias_deputado_leg_idx").on(
      t.deputadoId,
      t.legislaturaId,
    ),
    uniqueIndex("deputado_partido_vigencias_deputado_leg_inicio_uq")
      .on(t.deputadoId, t.legislaturaId, t.dataInicio)
      .where(sql`${t.dataInicio} IS NOT NULL`),
    check(
      "deputado_partido_vigencias_data_check",
      sql`${t.dataFim} IS NULL OR ${t.dataInicio} IS NULL OR ${t.dataFim} >= ${t.dataInicio}`,
    ),
  ],
);

export const tiposDespesa = pgTable(
  "tipos_despesa",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    nome: text("nome").notNull(),
  },
  (t) => [uniqueIndex("tipos_despesa_nome_uq").on(t.nome)],
);

export const fornecedores = pgTable(
  "fornecedores",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    nome: text("nome").notNull(),
    cnpjCpf: text("cnpj_cpf").notNull(),
  },
  (t) => [
    uniqueIndex("fornecedores_nome_cnpj_cpf_uq").on(t.nome, t.cnpjCpf),
    index("fornecedores_cnpj_cpf_idx").on(t.cnpjCpf),
  ],
);

export const despesas = pgTable(
  "despesas",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deputadoId: integer("deputado_id").notNull(),
    legislaturaId: integer("legislatura_id").notNull(),
    ano: integer("ano").notNull(),
    mes: integer("mes").notNull(),
    tipoDespesaId: bigint("tipo_despesa_id", { mode: "number" })
      .notNull()
      .references(() => tiposDespesa.id),
    codDocumento: text("cod_documento").notNull(),
    tipoDocumento: text("tipo_documento").notNull(),
    codTipoDocumento: integer("cod_tipo_documento").notNull(),
    dataDocumento: timestamp("data_documento", {
      withTimezone: false,
      mode: "string",
    }),
    numDocumento: text("num_documento").notNull(),
    parcela: integer("parcela").notNull(),
    numRessarcimento: text("num_ressarcimento").notNull(),
    codLote: integer("cod_lote").notNull(),
    fornecedorId: bigint("fornecedor_id", { mode: "number" })
      .notNull()
      .references(() => fornecedores.id),
    valorDocumento: numeric("valor_documento", {
      precision: 14,
      scale: 2,
      mode: "number",
    }).notNull(),
    valorGlosa: numeric("valor_glosa", {
      precision: 14,
      scale: 2,
      mode: "number",
    }).notNull(),
    valorLiquido: numeric("valor_liquido", {
      precision: 14,
      scale: 2,
      mode: "number",
    }).notNull(),
    urlDocumento: text("url_documento"),
    passageiro: text("passageiro"),
    trecho: text("trecho"),
    bilheteMatchAmbiguo: boolean("bilhete_match_ambiguo")
      .notNull()
      .default(false),
    rowHash: char("row_hash", { length: 64 }).notNull(),
    sourcePayloadId: bigint("source_payload_id", { mode: "number" }).references(
      () => rawPayloads.id,
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "despesas_deputado_legislatura_fk",
      columns: [t.deputadoId, t.legislaturaId],
      foreignColumns: [
        deputadoLegislaturas.deputadoId,
        deputadoLegislaturas.legislaturaId,
      ],
    }),
    uniqueIndex("despesas_natural_key_uq").on(
      t.deputadoId,
      t.legislaturaId,
      t.ano,
      t.mes,
      t.codDocumento,
      t.codLote,
      t.parcela,
    ),
    index("despesas_legislatura_periodo_idx").on(t.legislaturaId, t.ano, t.mes),
    index("despesas_tipo_despesa_idx").on(t.tipoDespesaId),
    index("despesas_fornecedor_idx").on(t.fornecedorId),
  ],
);

export const bilhetesAereosCsv = pgTable(
  "bilhetes_aereos_csv",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deputadoId: integer("deputado_id").notNull(),
    legislaturaId: integer("legislatura_id").notNull(),
    ano: integer("ano").notNull(),
    mes: integer("mes").notNull(),
    tipoDespesa: text("tipo_despesa").notNull(),
    codTipoDocumento: integer("cod_tipo_documento").notNull(),
    codDocumento: text("cod_documento").notNull(),
    dataDocumento: timestamp("data_documento", {
      withTimezone: false,
      mode: "string",
    }).notNull(),
    numDocumento: text("num_documento").notNull(),
    parcela: integer("parcela").notNull(),
    codLote: integer("cod_lote").notNull(),
    cnpjCpfFornecedor: text("cnpj_cpf_fornecedor").notNull(),
    valorDocumento: numeric("valor_documento", {
      precision: 14,
      scale: 2,
      mode: "number",
    }).notNull(),
    passageiro: text("passageiro").notNull(),
    trecho: text("trecho").notNull(),
    arquivo: text("arquivo").notNull(),
    linha: integer("linha").notNull(),
    status: text("status", { enum: ["available", "associated"] })
      .notNull()
      .default("available"),
    associatedExpenseId: bigint("associated_expense_id", {
      mode: "number",
    }).references(() => despesas.id),
  },
  (t) => [
    check(
      "bilhetes_aereos_csv_association_status_chk",
      sql`(${t.status} = 'available' AND ${t.associatedExpenseId} IS NULL) OR (${t.status} = 'associated' AND ${t.associatedExpenseId} IS NOT NULL)`,
    ),
    uniqueIndex("bilhetes_aereos_csv_identity_uq").on(
      t.deputadoId,
      t.legislaturaId,
      t.ano,
      t.mes,
      t.codDocumento,
      t.codTipoDocumento,
      t.dataDocumento,
      t.numDocumento,
      t.parcela,
      t.codLote,
      t.valorDocumento,
      t.passageiro,
      t.trecho,
    ),
    index("bilhetes_aereos_csv_match_idx").on(
      t.deputadoId,
      t.legislaturaId,
      t.ano,
      t.mes,
      t.codDocumento,
      t.dataDocumento,
      t.numDocumento,
    ),
    index("bilhetes_aereos_csv_status_year_idx").on(t.status, t.ano),
    index("bilhetes_aereos_csv_associated_expense_idx").on(
      t.associatedExpenseId,
    ),
  ],
);
