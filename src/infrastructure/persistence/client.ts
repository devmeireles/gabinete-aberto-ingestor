import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema.js";

/**
 * Tipo base do Drizzle para Postgres. Por quê não NodePgDatabase: os
 * repositórios só precisam da API de query, e assim os testes rodam o mesmo
 * código em PGlite (Postgres real em memória) sem tocar no Neon.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  /** Exposto para encerrar o pool no shutdown (SIGTERM do Cloud Run). */
  readonly pool: Pool;
}

/**
 * Por quê pool pequeno: no Cloud Run cada instância abre seu próprio pool.
 * Com N instâncias, conexões = N × max. Use a connection string POOLED do
 * Neon (host com "-pooler") para o PgBouncer absorver a escala.
 */
export function createDatabase(connectionString: string): DatabaseHandle {
  const pool: Pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const db: Database = drizzle(pool, { schema });
  return { db, pool };
}
