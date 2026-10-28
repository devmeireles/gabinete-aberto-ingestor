import {
  bigint,
  bigserial,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
 * Contexto temporal: partido, UF e e-mail pertencem à (deputado, legislatura),
 * não ao deputado. Um deputado pode trocar de partido entre legislaturas.
 *
 * partido_id é uma referência "suave" (sem FK) extraída de uriPartido: não
 * queremos que uma inconsistência da fonte trave a ingestão. Divergências
 * viram checagem de qualidade de dados, não erro de carga.
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
    siglaPartido: text("sigla_partido"),
    partidoId: integer("partido_id"),
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
  (t) => [
    primaryKey({ columns: [t.deputadoId, t.legislaturaId] }),
    index("deputado_leg_partido_idx").on(t.partidoId),
  ],
);
