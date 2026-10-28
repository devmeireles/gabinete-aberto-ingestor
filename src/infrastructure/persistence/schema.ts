import {
  bigint,
  bigserial,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
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
