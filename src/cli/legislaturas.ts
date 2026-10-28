import "dotenv/config";
import type { Page } from "@/application/ports/camara-gateway/page";
import type { LegislaturaDto } from "@/application/ports/camara-gateway/legislaturas";
import { mapLegislatura } from "@/application/mappers/legislatura-mapper";
import { SyncLegislaturas } from "@/application/use-cases/sync-legislaturas";
import { loadCamaraEnv } from "@/config/env";
import {
  CamaraHttpClient,
  DEFAULT_OPTIONS,
} from "@/infrastructure/camara/camara-http-client";
import { HttpCamaraGateway } from "@/infrastructure/camara/http-camara-gateway";
import { RequestScheduler } from "@/infrastructure/camara/request-scheduler";
import { createDatabase } from "@/infrastructure/persistence/client";
import type { DatabaseHandle } from "@/infrastructure/persistence/client";
import { DrizzleLegislaturaRepository } from "@/infrastructure/persistence/drizzle-legislatura-repository";
import { DrizzleRawPayloadStore } from "@/infrastructure/persistence/drizzle-raw-payload-store";

const MAX_PAGES: number = 50;

interface CrawlerOptions {
  readonly pageLimit: number;
  readonly legislaturaId?: number;
  readonly persist: boolean;
}

export function parseCrawlerOptions(args: readonly string[]): CrawlerOptions {
  let pageLimit: number = MAX_PAGES;
  let legislaturaId: number | undefined;
  let persist: boolean = false;
  let modeWasSelected: boolean = false;

  for (let index: number = 0; index < args.length; index++) {
    const argument: string = args[index];
    let value: string | undefined;

    if (argument === "--persist") {
      if (modeWasSelected) {
        throw new Error("Escolha apenas um modo: --dry-run ou --persist");
      }
      persist = true;
      modeWasSelected = true;
      continue;
    } else if (argument === "--dry-run") {
      if (modeWasSelected) {
        throw new Error("Escolha apenas um modo: --dry-run ou --persist");
      }
      persist = false;
      modeWasSelected = true;
      continue;
    } else if (argument.startsWith("--pages=")) {
      value = argument.slice("--pages=".length);
    } else if (argument === "--pages") {
      index++;
      value = args[index];
    } else if (argument.startsWith("--legislatura=")) {
      value = argument.slice("--legislatura=".length);
      legislaturaId = parseLegislaturaId(value);
      continue;
    } else if (argument === "--legislatura") {
      index++;
      value = args[index];
      legislaturaId = parseLegislaturaId(value);
      continue;
    } else {
      throw new Error(`Argumento desconhecido: ${argument}`);
    }

    const parsed: number = Number(value);
    if (
      value === undefined ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_PAGES
    ) {
      throw new Error(`--pages deve ser um inteiro entre 1 e ${MAX_PAGES}`);
    }
    pageLimit = parsed;
  }

  return { pageLimit, legislaturaId, persist };
}

function parseLegislaturaId(value: string | undefined): number {
  const parsed: number = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--legislatura deve ser um inteiro positivo");
  }
  return parsed;
}

export async function runLegislaturas(args: readonly string[]): Promise<void> {
  const options: CrawlerOptions = parseCrawlerOptions(args);
  const env = loadCamaraEnv();
  const scheduler: RequestScheduler = new RequestScheduler(
    env.camaraMaxConcurrent,
    env.camaraMinIntervalMs,
  );
  const gateway: HttpCamaraGateway = new HttpCamaraGateway(
    new CamaraHttpClient(scheduler, DEFAULT_OPTIONS),
  );
  let database: DatabaseHandle | undefined;
  let sync: SyncLegislaturas | undefined;
  if (options.persist) {
    const databaseUrl: string | undefined = process.env["DATABASE_URL"];
    if (databaseUrl === undefined || databaseUrl.trim() === "") {
      throw new Error("DATABASE_URL é obrigatória para usar --persist");
    }
    database = createDatabase(databaseUrl);
    sync = new SyncLegislaturas(
      gateway,
      new DrizzleRawPayloadStore(database.db),
      new DrizzleLegislaturaRepository(database.db),
    );
  }

  try {
    let pageNumber: number = 1;
    let fetched: number = 0;
    let validated: number = 0;
    let written: number = 0;
    let unchanged: number = 0;
    let hasNext: boolean;

    do {
      if (sync !== undefined) {
        const result = await sync.executePage(
          pageNumber,
          options.legislaturaId,
        );
        fetched += result.fetched;
        validated += result.fetched;
        written += result.written;
        unchanged += result.unchanged;
        hasNext = result.hasNext;

        console.log(
          JSON.stringify({
            event: "crawler.legislaturas.page",
            page: result.page,
            fetched: result.fetched,
            written: result.written,
            unchanged: result.unchanged,
            hasNext,
            persist: true,
          }),
        );
      } else {
        const page: Page<LegislaturaDto> = await gateway.listLegislaturas({
          pagina: pageNumber,
          ...(options.legislaturaId === undefined
            ? {}
            : { id: options.legislaturaId }),
        });
        if (
          options.legislaturaId !== undefined &&
          page.items.some((item) => item.id !== options.legislaturaId)
        ) {
          throw new Error(
            `A API retornou uma legislatura diferente de ${options.legislaturaId}`,
          );
        }
        const entities = page.items.map(mapLegislatura);
        fetched += page.items.length;
        validated += entities.length;
        hasNext = page.hasNext;

        console.log(
          JSON.stringify({
            event: "crawler.legislaturas.page",
            page: page.page,
            requestKey: page.requestKey,
            fetched: page.items.length,
            validated: entities.length,
            hasNext,
            persist: false,
          }),
        );

        if (fetched === page.items.length && page.items.length > 0) {
          console.log(
            JSON.stringify(
              {
                event: "crawler.legislaturas.sample",
                legislatura: entities[0],
                source: page.items[0],
              },
              null,
              2,
            ),
          );
        }
      }

      pageNumber++;
    } while (hasNext && pageNumber <= options.pageLimit);

    console.log(
      JSON.stringify({
        event: "crawler.legislaturas.completed",
        pages: pageNumber - 1,
        fetched,
        validated,
        written,
        unchanged,
        legislaturaId: options.legislaturaId ?? null,
        truncated: hasNext,
        persist: options.persist,
      }),
    );
  } finally {
    if (database !== undefined) {
      await database.pool.end();
    }
  }
}
