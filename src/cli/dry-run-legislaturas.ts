import "dotenv/config";
import type { Page } from "@/application/ports/camara-gateway/page";
import type { LegislaturaDto } from "@/application/ports/camara-gateway/legislaturas";
import { mapLegislatura } from "@/application/mappers/legislatura-mapper";
import { loadCamaraEnv } from "@/config/env";
import {
  CamaraHttpClient,
  DEFAULT_OPTIONS,
} from "@/infrastructure/camara/camara-http-client";
import { HttpCamaraGateway } from "@/infrastructure/camara/http-camara-gateway";
import { RequestScheduler } from "@/infrastructure/camara/request-scheduler";

const MAX_PAGES: number = 50;

interface DryRunOptions {
  readonly pageLimit: number;
  readonly legislaturaId?: number;
}

export function parseDryRunOptions(args: readonly string[]): DryRunOptions {
  let pageLimit: number = 1;
  let legislaturaId: number | undefined;

  for (let index: number = 0; index < args.length; index++) {
    const argument: string = args[index];
    let value: string | undefined;

    if (argument.startsWith("--pages=")) {
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

  return { pageLimit, legislaturaId };
}

function parseLegislaturaId(value: string | undefined): number {
  const parsed: number = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--legislatura deve ser um inteiro positivo");
  }
  return parsed;
}

async function run(): Promise<void> {
  const options: DryRunOptions = parseDryRunOptions(process.argv.slice(2));
  const env = loadCamaraEnv();
  const scheduler: RequestScheduler = new RequestScheduler(
    env.camaraMaxConcurrent,
    env.camaraMinIntervalMs,
  );
  const gateway: HttpCamaraGateway = new HttpCamaraGateway(
    new CamaraHttpClient(scheduler, DEFAULT_OPTIONS),
  );

  let pageNumber: number = 1;
  let fetched: number = 0;
  let validated: number = 0;
  let hasNext: boolean;

  do {
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
        event: "crawler.dry_run.page",
        page: page.page,
        requestKey: page.requestKey,
        fetched: page.items.length,
        validated: entities.length,
        hasNext,
        writes: { rawPayload: false, postgres: false },
      }),
    );

    if (fetched === page.items.length && page.items.length > 0) {
      console.log(
        JSON.stringify(
          {
            event: "crawler.dry_run.sample",
            legislatura: entities[0],
            source: page.items[0],
          },
          null,
          2,
        ),
      );
    }

    pageNumber++;
  } while (hasNext && pageNumber <= options.pageLimit);

  console.log(
    JSON.stringify({
      event: "crawler.dry_run.completed",
      pages: pageNumber - 1,
      fetched,
      validated,
      legislaturaId: options.legislaturaId ?? null,
      truncated: hasNext,
      writes: { rawPayload: false, postgres: false },
    }),
  );
}

run().catch((error: unknown) => {
  const message: string =
    error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "crawler.dry_run.failed", message }));
  process.exitCode = 1;
});
