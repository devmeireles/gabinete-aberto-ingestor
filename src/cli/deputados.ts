import "dotenv/config";
import type { Page } from "@/application/ports/camara-gateway/page";
import type { DeputadoDto } from "@/application/ports/camara-gateway/deputados";
import { mapDeputado } from "@/application/mappers/deputado-mapper";
import { SyncDeputados } from "@/application/use-cases/sync-deputados";
import {
  CamaraHttpClient,
  DEFAULT_OPTIONS,
} from "@/infrastructure/camara/camara-http-client";
import { HttpCamaraGateway } from "@/infrastructure/camara/http-camara-gateway";
import { RequestScheduler } from "@/infrastructure/camara/request-scheduler";
import { createDatabase } from "@/infrastructure/persistence/client";
import { DrizzleDeputadoRepository } from "@/infrastructure/persistence/drizzle-deputado-repository";
import { DrizzleRawPayloadStore } from "@/infrastructure/persistence/drizzle-raw-payload-store";
import type { DatabaseHandle } from "@/infrastructure/persistence/client";
import { loadCamaraEnv } from "@/config/env";

const MAX_PAGES: number = 50;

interface Options {
  readonly legislaturaId: number;
  readonly pageLimit: number;
  readonly persist: boolean;
}

export function parseDeputadoOptions(args: readonly string[]): Options {
  let legislaturaId: number | undefined;
  let pageLimit: number = MAX_PAGES;
  let persist: boolean = false;
  let modeWasSelected: boolean = false;

  for (let index: number = 0; index < args.length; index++) {
    const argument: string = args[index];
    if (argument === "--persist") {
      if (modeWasSelected) {
        throw new Error("Escolha apenas um modo: --dry-run ou --persist");
      }
      persist = true;
      modeWasSelected = true;
      continue;
    }
    if (argument === "--dry-run") {
      if (modeWasSelected) {
        throw new Error("Escolha apenas um modo: --dry-run ou --persist");
      }
      persist = false;
      modeWasSelected = true;
      continue;
    }

    let value: string | undefined;
    let option: string;
    if (argument.startsWith("--legislatura=")) {
      option = "--legislatura";
      value = argument.slice(option.length + 1);
    } else if (argument === "--legislatura") {
      option = argument;
      value = args[++index];
    } else if (argument.startsWith("--pages=")) {
      option = "--pages";
      value = argument.slice(option.length + 1);
    } else if (argument === "--pages") {
      option = argument;
      value = args[++index];
    } else {
      throw new Error(`Argumento desconhecido: ${argument}`);
    }

    const parsed: number = Number(value);
    const maximum: number =
      option === "--pages" ? MAX_PAGES : Number.MAX_SAFE_INTEGER;
    if (
      value === undefined ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > maximum
    ) {
      throw new Error(
        option === "--pages"
          ? `--pages deve ser um inteiro entre 1 e ${MAX_PAGES}`
          : "--legislatura deve ser um inteiro positivo",
      );
    }

    if (option === "--legislatura") legislaturaId = parsed;
    else pageLimit = parsed;
  }

  if (legislaturaId === undefined) {
    throw new Error("Informe a legislatura com --legislatura=<id>");
  }
  return { legislaturaId, pageLimit, persist };
}

export async function runDeputados(args: readonly string[]): Promise<void> {
  const options: Options = parseDeputadoOptions(args);
  const env = loadCamaraEnv();
  const scheduler: RequestScheduler = new RequestScheduler(
    env.camaraMaxConcurrent,
    env.camaraMinIntervalMs,
  );
  const gateway: HttpCamaraGateway = new HttpCamaraGateway(
    new CamaraHttpClient(scheduler, DEFAULT_OPTIONS),
  );

  let database: DatabaseHandle | undefined;
  let sync: SyncDeputados | undefined;
  if (options.persist) {
    const databaseUrl: string | undefined = process.env["DATABASE_URL"];
    if (databaseUrl === undefined || databaseUrl.trim() === "") {
      throw new Error("DATABASE_URL é obrigatória para usar --persist");
    }
    database = createDatabase(databaseUrl);
    sync = new SyncDeputados(
      gateway,
      new DrizzleRawPayloadStore(database.db),
      new DrizzleDeputadoRepository(database.db),
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
          options.legislaturaId,
          pageNumber,
        );
        fetched += result.fetched;
        validated += result.fetched;
        written += result.written;
        unchanged += result.unchanged;
        hasNext = result.hasNext;
        console.log(
          JSON.stringify({
            event: "crawler.deputados.page",
            page: result.page,
            fetched: result.fetched,
            written: result.written,
            unchanged: result.unchanged,
            hasNext,
            persist: true,
          }),
        );
      } else {
        const page: Page<DeputadoDto> = await gateway.listDeputados({
          idLegislatura: options.legislaturaId,
          pagina: pageNumber,
        });
        const mapped = page.items.map((dto: DeputadoDto) =>
          mapDeputado(dto, options.legislaturaId),
        );
        fetched += page.items.length;
        validated += mapped.length;
        hasNext = page.hasNext;
        console.log(
          JSON.stringify({
            event: "crawler.deputados.page",
            page: page.page,
            requestKey: page.requestKey,
            fetched: page.items.length,
            validated: mapped.length,
            hasNext,
            persist: false,
          }),
        );

        if (pageNumber === 1 && mapped.length > 0) {
          console.log(
            JSON.stringify(
              {
                event: "crawler.deputados.sample",
                deputado: mapped[0].deputado,
                legislatura: mapped[0].legislatura,
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
        event: "crawler.deputados.completed",
        legislaturaId: options.legislaturaId,
        pages: pageNumber - 1,
        fetched,
        validated,
        written,
        unchanged,
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
