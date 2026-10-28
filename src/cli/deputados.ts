import "dotenv/config";
import { mapLegislatura } from "@/application/mappers/legislatura-mapper";
import { mapPartido } from "@/application/mappers/partido-mapper";
import {
  PrepareDeputadosPage,
  type DeputadoHistoryProgress,
} from "@/application/use-cases/prepare-deputados-page";
import { SyncDeputados } from "@/application/use-cases/sync-deputados";
import { SyncPartidos } from "@/application/use-cases/sync-partidos";
import {
  CamaraHttpClient,
  DEFAULT_OPTIONS,
} from "@/infrastructure/camara/camara-http-client";
import { HttpCamaraGateway } from "@/infrastructure/camara/http-camara-gateway";
import { RequestScheduler } from "@/infrastructure/camara/request-scheduler";
import { createDatabase } from "@/infrastructure/persistence/client";
import { DrizzleDeputadoRepository } from "@/infrastructure/persistence/drizzle-deputado-repository";
import { DrizzlePartidoRepository } from "@/infrastructure/persistence/drizzle-partido-repository";
import { DrizzleRawPayloadStore } from "@/infrastructure/persistence/drizzle-raw-payload-store";
import type { DatabaseHandle } from "@/infrastructure/persistence/client";
import { loadCamaraEnv } from "@/config/env";
import { eq } from "drizzle-orm";
import { legislaturas } from "@/infrastructure/persistence/schema";

const MAX_PAGES: number = 50;
const HISTORY_PROGRESS_INTERVAL: number = 25;

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

function reportHistoryProgress(
  page: number,
): (progress: DeputadoHistoryProgress) => void {
  return (progress: DeputadoHistoryProgress): void => {
    if (progress.stage === "started") {
      console.log(
        JSON.stringify({
          event: "crawler.deputados.history.started",
          page,
          total: progress.total,
        }),
      );
      return;
    }

    if (progress.stage === "failed") {
      console.error(
        JSON.stringify({
          event: "crawler.deputados.history.failed",
          page,
          completed: progress.completed,
          total: progress.total,
          deputadoId: progress.deputadoId,
          error:
            progress.error instanceof Error
              ? progress.error.message
              : String(progress.error),
        }),
      );
      return;
    }

    if (
      progress.completed % HISTORY_PROGRESS_INTERVAL === 0 ||
      progress.completed === progress.total
    ) {
      console.log(
        JSON.stringify({
          event: "crawler.deputados.history.progress",
          page,
          completed: progress.completed,
          total: progress.total,
        }),
      );
    }
  };
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
  const prepareDeputadosPage: PrepareDeputadosPage = new PrepareDeputadosPage(
    gateway,
  );

  let database: DatabaseHandle | undefined;
  let sync: SyncDeputados | undefined;
  let syncPartidos: SyncPartidos | undefined;
  if (options.persist) {
    const databaseUrl: string | undefined = process.env["DATABASE_URL"];
    if (databaseUrl === undefined || databaseUrl.trim() === "") {
      throw new Error("DATABASE_URL é obrigatória para usar --persist");
    }
    database = createDatabase(databaseUrl);
    const rawStore: DrizzleRawPayloadStore = new DrizzleRawPayloadStore(
      database.db,
    );
    syncPartidos = new SyncPartidos(
      gateway,
      rawStore,
      new DrizzlePartidoRepository(database.db),
    );
    sync = new SyncDeputados(
      prepareDeputadosPage,
      rawStore,
      new DrizzleDeputadoRepository(database.db),
    );
  }

  try {
    const knownPartidos: Map<number, string> = new Map<number, string>();
    const pageLegislaturas = await gateway.listLegislaturas({
      pagina: 1,
      id: options.legislaturaId,
    });
    pageLegislaturas.items.map((item) => mapLegislatura(item));
    const legislaturaCount: number = pageLegislaturas.items.length;
    if (
      pageLegislaturas.items.some((item) => item.id !== options.legislaturaId)
    ) {
      throw new Error(
        `A API retornou uma legislatura diferente de ${options.legislaturaId}`,
      );
    }
    if (legislaturaCount !== 1) {
      throw new Error(
        `Legislatura ${options.legislaturaId} não foi encontrada de forma única na API`,
      );
    }
    if (database !== undefined) {
      const storedLegislatura = await database.db
        .select({ id: legislaturas.id })
        .from(legislaturas)
        .where(eq(legislaturas.id, options.legislaturaId));
      if (storedLegislatura.length !== 1) {
        throw new Error(
          `Legislatura ${options.legislaturaId} não está no banco; envie o evento Inngest camara/legislaturas.seed antes de persistir deputados`,
        );
      }
    }

    let partyPageNumber: number = 1;
    let partyHasNext: boolean;
    let partyCount: number = 0;
    do {
      if (syncPartidos !== undefined) {
        const result = await syncPartidos.executePage(
          options.legislaturaId,
          partyPageNumber,
        );
        result.partidos.forEach(({ id, sigla }) =>
          knownPartidos.set(id, sigla),
        );
        partyCount += result.fetched;
        partyHasNext = result.hasNext;
        console.log(
          JSON.stringify({
            event: "crawler.partidos.page",
            page: result.page,
            fetched: result.fetched,
            written: result.written,
            unchanged: result.unchanged,
            hasNext: partyHasNext,
            persist: true,
          }),
        );
      } else {
        const page = await gateway.listPartidos({
          idLegislatura: options.legislaturaId,
          pagina: partyPageNumber,
        });
        const mapped = page.items.map((dto) =>
          mapPartido(dto, options.legislaturaId),
        );
        mapped.forEach(({ partido }) =>
          knownPartidos.set(partido.id, partido.sigla),
        );
        partyCount += mapped.length;
        partyHasNext = page.hasNext;
        console.log(
          JSON.stringify({
            event: "crawler.partidos.page",
            page: page.page,
            requestKey: page.requestKey,
            fetched: page.items.length,
            validated: mapped.length,
            hasNext: partyHasNext,
            persist: false,
          }),
        );
      }

      partyPageNumber++;
      if (partyHasNext && partyPageNumber > MAX_PAGES) {
        throw new Error(
          `Sincronização de partidos passou de ${MAX_PAGES} páginas`,
        );
      }
    } while (partyHasNext);

    let pageNumber: number = 1;
    let fetched: number = 0;
    let validated: number = 0;
    let written: number = 0;
    let unchanged: number = 0;
    let duplicateRecords: number = 0;
    let partyAffiliations: number = 0;
    const seenDeputadoIds: Set<number> = new Set();
    let hasNext: boolean;

    do {
      if (sync !== undefined) {
        const result = await sync.executePage(
          options.legislaturaId,
          pageNumber,
          knownPartidos,
          seenDeputadoIds,
          reportHistoryProgress(pageNumber),
        );
        result.deputadoIds.forEach((deputadoId) =>
          seenDeputadoIds.add(deputadoId),
        );
        fetched += result.fetched;
        validated += result.validated;
        duplicateRecords += result.duplicateRecords;
        partyAffiliations += result.partyAffiliations;
        written += result.written;
        unchanged += result.unchanged;
        hasNext = result.hasNext;
        console.log(
          JSON.stringify({
            event: "crawler.deputados.page",
            page: result.page,
            fetched: result.fetched,
            validated: result.validated,
            duplicateRecords: result.duplicateRecords,
            partyAffiliations: result.partyAffiliations,
            written: result.written,
            unchanged: result.unchanged,
            hasNext,
            persist: true,
          }),
        );
      } else {
        const prepared = await prepareDeputadosPage.execute(
          options.legislaturaId,
          pageNumber,
          knownPartidos,
          seenDeputadoIds,
          reportHistoryProgress(pageNumber),
        );
        prepared.deputadoIds.forEach((deputadoId) =>
          seenDeputadoIds.add(deputadoId),
        );
        const pageAffiliations: number = prepared.historicos.reduce(
          (count, history) => count + history.vigencias.length,
          0,
        );
        fetched += prepared.fetched;
        validated += prepared.deputados.length;
        duplicateRecords += prepared.duplicateRecords;
        partyAffiliations += pageAffiliations;
        hasNext = prepared.hasNext;
        console.log(
          JSON.stringify({
            event: "crawler.deputados.page",
            page: prepared.page,
            requestKey: prepared.requestKey,
            fetched: prepared.fetched,
            validated: prepared.deputados.length,
            duplicateRecords: prepared.duplicateRecords,
            partyAffiliations: pageAffiliations,
            hasNext,
            persist: false,
          }),
        );

        if (pageNumber === 1 && prepared.deputados.length > 0) {
          const sample = prepared.deputados[0];
          const history = prepared.historicos.find(
            (item) => item.deputadoId === sample?.deputado.id,
          );
          console.log(
            JSON.stringify(
              {
                event: "crawler.deputados.sample",
                deputado: sample?.deputado,
                legislatura: sample?.legislatura,
                partidoHistorico: history?.vigencias,
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
        legislaturas: legislaturaCount,
        partidos: partyCount,
        pages: pageNumber - 1,
        fetched,
        validated,
        duplicateRecords,
        partyAffiliations,
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
