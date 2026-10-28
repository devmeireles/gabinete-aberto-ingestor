import type { Server } from "node:http";
import { SyncLegislaturas } from "./application/use-cases/sync-legislaturas";
import { SyncDespesas } from "./application/use-cases/sync-despesas";
import { loadEnv, type Env } from "./config/env";
import {
  CamaraHttpClient,
  DEFAULT_OPTIONS,
} from "./infrastructure/camara/camara-http-client";
import { HttpCamaraGateway } from "./infrastructure/camara/http-camara-gateway";
import { RequestScheduler } from "./infrastructure/camara/request-scheduler";
import {
  createDatabase,
  type DatabaseHandle,
} from "@/infrastructure/persistence/client";
import { DrizzleLegislaturaRepository } from "@/infrastructure/persistence/drizzle-legislatura-repository";
import { DrizzleRawPayloadStore } from "@/infrastructure/persistence/drizzle-raw-payload-store";
import { DrizzleDespesaRepository } from "@/infrastructure/persistence/drizzle-despesa-repository";
import { DrizzleCrawlerRunRepository } from "@/infrastructure/persistence/drizzle-crawler-run-repository";
import { createApp } from "@/infrastructure/http/server";
import { createSyncLegislaturasFunction } from "@/infrastructure/inngest/functions/sync-legislaturas.function";
import { createSyncDespesasFunction } from "@/infrastructure/inngest/functions/sync-despesas.function";

/**
 * COMPOSITION ROOT: o único lugar que conhece todas as implementações
 * concretas e as liga às portas. Trocar Drizzle, o cliente HTTP ou o
 * orquestrador acontece aqui, sem tocar em domain/application.
 */
function main(): void {
  const env: Env = loadEnv();

  const database: DatabaseHandle = createDatabase(env.databaseUrl);
  const scheduler: RequestScheduler = new RequestScheduler(
    env.camaraMaxConcurrent,
    env.camaraMinIntervalMs,
  );
  const gateway: HttpCamaraGateway = new HttpCamaraGateway(
    new CamaraHttpClient(scheduler, DEFAULT_OPTIONS),
  );

  const syncLegislaturas: SyncLegislaturas = new SyncLegislaturas(
    gateway,
    new DrizzleRawPayloadStore(database.db),
    new DrizzleLegislaturaRepository(database.db),
  );
  const syncDespesas: SyncDespesas = new SyncDespesas(
    gateway,
    new DrizzleRawPayloadStore(database.db),
    new DrizzleDespesaRepository(database.db),
  );
  const crawlerRunRepository: DrizzleCrawlerRunRepository =
    new DrizzleCrawlerRunRepository(database.db);

  const server: Server = createApp([
    createSyncLegislaturasFunction(syncLegislaturas, crawlerRunRepository),
    createSyncDespesasFunction(syncDespesas, crawlerRunRepository),
  ]).listen(env.port, () => {
    console.log(JSON.stringify({ msg: "camara-etl ouvindo", port: env.port }));
  });

  // O Cloud Run manda SIGTERM antes de derrubar a instância: terminamos as
  // requisições em andamento e fechamos o pool, em vez de cortar steps no meio.
  const shutdown = (signal: string): void => {
    console.log(JSON.stringify({ msg: "encerrando", signal }));
    const force: NodeJS.Timeout = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      void database.pool.end().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
