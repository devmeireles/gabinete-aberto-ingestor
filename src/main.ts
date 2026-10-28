import type { Server } from "node:http";
import { SyncLegislaturas } from "./application/use-cases/sync-legislaturas";
import { SyncPartidos } from "./application/use-cases/sync-partidos";
import { SyncDeputados } from "./application/use-cases/sync-deputados";
import { PrepareDeputadosPage } from "./application/use-cases/prepare-deputados-page";
import { EnrichDeputado } from "./application/use-cases/enrich-deputado";
import { SyncDespesas } from "./application/use-cases/sync-despesas";
import { ImportBilhetesAereosCsv } from "./application/use-cases/import-bilhetes-aereos-csv";
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
import { DrizzlePartidoRepository } from "@/infrastructure/persistence/drizzle-partido-repository";
import { DrizzleDeputadoRepository } from "@/infrastructure/persistence/drizzle-deputado-repository";
import { DrizzleRawPayloadStore } from "@/infrastructure/persistence/drizzle-raw-payload-store";
import { DrizzleDespesaRepository } from "@/infrastructure/persistence/drizzle-despesa-repository";
import { StreamingBilheteAereoCsvSource } from "@/infrastructure/csv/streaming-bilhete-aereo-csv-source";
import { HttpBilheteAereoCsvArchiveSource } from "@/infrastructure/csv/http-bilhete-aereo-csv-archive-source";
import { DrizzleCrawlerRunRepository } from "@/infrastructure/persistence/drizzle-crawler-run-repository";
import { createApp } from "@/infrastructure/http/server";
import { createSeedLegislaturasFunction } from "@/infrastructure/inngest/functions/seed-legislaturas.function";
import { createSeedDeputadosFunction } from "@/infrastructure/inngest/functions/seed-deputados.function";
import { createSeedPerfilDeputadoFunction } from "@/infrastructure/inngest/functions/seed-perfis-deputados.function";
import { createSyncDespesasFunction } from "@/infrastructure/inngest/functions/sync-despesas.function";
import { createSeedBilhetesAereosFunction } from "@/infrastructure/inngest/functions/seed-bilhetes-aereos.function";

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
  const deputadoRepository: DrizzleDeputadoRepository =
    new DrizzleDeputadoRepository(database.db);
  const rawPayloadStore: DrizzleRawPayloadStore = new DrizzleRawPayloadStore(
    database.db,
  );
  const syncPartidos: SyncPartidos = new SyncPartidos(
    gateway,
    rawPayloadStore,
    new DrizzlePartidoRepository(database.db),
  );
  const syncDeputados: SyncDeputados = new SyncDeputados(
    new PrepareDeputadosPage(gateway),
    rawPayloadStore,
    deputadoRepository,
  );
  const enrichDeputado: EnrichDeputado = new EnrichDeputado(
    gateway,
    rawPayloadStore,
    deputadoRepository,
  );
  const despesaRepository: DrizzleDespesaRepository =
    new DrizzleDespesaRepository(database.db);
  const syncDespesas: SyncDespesas = new SyncDespesas(
    gateway,
    new DrizzleRawPayloadStore(database.db),
    despesaRepository,
  );
  const importBilhetesAereosCsv: ImportBilhetesAereosCsv =
    new ImportBilhetesAereosCsv(
      new StreamingBilheteAereoCsvSource(),
      despesaRepository,
    );
  const crawlerRunRepository: DrizzleCrawlerRunRepository =
    new DrizzleCrawlerRunRepository(database.db);

  const server: Server = createApp([
    createSeedLegislaturasFunction(syncLegislaturas, crawlerRunRepository),
    createSeedDeputadosFunction(
      syncPartidos,
      syncDeputados,
      crawlerRunRepository,
    ),
    createSeedPerfilDeputadoFunction(enrichDeputado, crawlerRunRepository),
    createSyncDespesasFunction(syncDespesas, crawlerRunRepository),
    createSeedBilhetesAereosFunction(
      importBilhetesAereosCsv,
      new HttpBilheteAereoCsvArchiveSource(),
      crawlerRunRepository,
    ),
  ]).listen(env.port, () => {
    console.log(
      JSON.stringify({
        msg: "gabinete-aberto-ingestor ouvindo",
        port: env.port,
      }),
    );
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
