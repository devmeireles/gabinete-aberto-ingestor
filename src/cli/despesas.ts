import "dotenv/config";
import { mapDespesa } from "@/application/mappers/despesa-mapper";
import { SyncDespesas } from "@/application/use-cases/sync-despesas";
import type { DespesaDto } from "@/application/ports/camara-gateway/despesas";
import type { Page } from "@/application/ports/camara-gateway/page";
import {
  CamaraHttpClient,
  DEFAULT_OPTIONS,
} from "@/infrastructure/camara/camara-http-client";
import { HttpCamaraGateway } from "@/infrastructure/camara/http-camara-gateway";
import { RequestScheduler } from "@/infrastructure/camara/request-scheduler";
import { loadCamaraEnv } from "@/config/env";
import {
  createDatabase,
  type DatabaseHandle,
} from "@/infrastructure/persistence/client";
import { DrizzleDespesaRepository } from "@/infrastructure/persistence/drizzle-despesa-repository";
import { DrizzleRawPayloadStore } from "@/infrastructure/persistence/drizzle-raw-payload-store";
import type { Despesa } from "@/domain/model/despesa";

const MAX_PAGES: number = 500;
const MAX_MONTHS: number = 120;

interface Month {
  readonly ano: number;
  readonly mes: number;
}

interface Options {
  readonly legislaturaId?: number;
  readonly deputadoId?: number;
  readonly ano?: number;
  readonly mes?: number;
  readonly desde?: Month;
  readonly ate?: Month;
  readonly pageLimit: number;
  readonly persist: boolean;
}

function parseMonth(value: string, option: string): Month {
  const match: RegExpMatchArray | null = /^(\d{4})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`${option} deve estar no formato AAAA-MM`);
  }
  const ano: number = Number(match[1]);
  const mes: number = Number(match[2]);
  if (ano < 1900 || mes < 1 || mes > 12) {
    throw new Error(`${option} contém ano ou mês inválido`);
  }
  return { ano, mes };
}

export function parseDespesaOptions(args: readonly string[]): Options {
  let legislaturaId: number | undefined;
  let deputadoId: number | undefined;
  let ano: number | undefined;
  let mes: number | undefined;
  let desde: Month | undefined;
  let ate: Month | undefined;
  let pageLimit: number = MAX_PAGES;
  let persist: boolean = false;
  let modeWasSelected: boolean = false;

  for (let index: number = 0; index < args.length; index++) {
    const argument: string = args[index]!;
    if (argument === "--persist" || argument === "--dry-run") {
      if (modeWasSelected) {
        throw new Error("Escolha apenas um modo: --dry-run ou --persist");
      }
      persist = argument === "--persist";
      modeWasSelected = true;
      continue;
    }

    const separator: number = argument.indexOf("=");
    const option: string =
      separator < 0 ? argument : argument.slice(0, separator);
    let value: string | undefined =
      separator < 0 ? undefined : argument.slice(separator + 1);
    if (
      value === undefined &&
      [
        "--legislatura",
        "--deputado",
        "--ano",
        "--mes",
        "--desde",
        "--ate",
        "--pages",
      ].includes(option)
    ) {
      value = args[++index];
    }
    if (value === undefined || value.trim() === "") {
      throw new Error(`Informe um valor para ${option}`);
    }

    if (option === "--desde" || option === "--ate") {
      const month = parseMonth(value, option);
      if (option === "--desde") desde = month;
      else ate = month;
      continue;
    }
    const parsed: number = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Valor inválido para ${option}: ${value}`);
    }
    switch (option) {
      case "--legislatura":
        legislaturaId = parsed;
        break;
      case "--deputado":
        deputadoId = parsed;
        break;
      case "--ano":
        if (parsed < 1900)
          throw new Error("--ano deve ser igual ou superior a 1900");
        ano = parsed;
        break;
      case "--mes":
        mes = parsed;
        break;
      case "--pages":
        if (parsed > MAX_PAGES) {
          throw new Error(`--pages deve ser entre 1 e ${MAX_PAGES}`);
        }
        pageLimit = parsed;
        break;
      default:
        throw new Error(`Argumento desconhecido: ${option}`);
    }
  }

  if (legislaturaId === undefined) {
    throw new Error("Informe --legislatura=<id>");
  }
  if (deputadoId === undefined && !persist) {
    throw new Error("No dry-run, informe também --deputado=<id>");
  }
  if ((ano === undefined) !== (mes === undefined)) {
    throw new Error("Informe --ano e --mes juntos");
  }
  if (mes !== undefined && mes > 12) {
    throw new Error("--mes deve estar entre 1 e 12");
  }
  if ((desde === undefined) !== (ate === undefined)) {
    throw new Error("Informe --desde e --ate juntos");
  }
  if (ano !== undefined && (desde !== undefined || ate !== undefined)) {
    throw new Error("Use --ano/--mes ou --desde/--ate, não ambos");
  }
  const months: readonly Month[] =
    ano !== undefined && mes !== undefined
      ? [{ ano, mes }]
      : desde !== undefined && ate !== undefined
        ? monthRange(desde, ate)
        : recentMonths(new Date());
  if (months.length > MAX_MONTHS) {
    throw new Error(`O intervalo não pode exceder ${MAX_MONTHS} meses`);
  }
  return {
    legislaturaId,
    ...(deputadoId === undefined ? {} : { deputadoId }),
    ...(ano === undefined ? {} : { ano }),
    ...(mes === undefined ? {} : { mes }),
    ...(desde === undefined ? {} : { desde }),
    ...(ate === undefined ? {} : { ate }),
    pageLimit,
    persist,
  };
}

function monthIndex(month: Month): number {
  return month.ano * 12 + month.mes - 1;
}

function monthRange(from: Month, to: Month): readonly Month[] {
  if (monthIndex(from) > monthIndex(to)) {
    throw new Error("--desde deve ser anterior ou igual a --ate");
  }
  const length: number = monthIndex(to) - monthIndex(from) + 1;
  if (length > MAX_MONTHS) {
    throw new Error(`O intervalo não pode exceder ${MAX_MONTHS} meses`);
  }
  return Array.from({ length }, (_, offset) => {
    const index: number = monthIndex(from) + offset;
    return { ano: Math.floor(index / 12), mes: (index % 12) + 1 };
  });
}

function recentMonths(now: Date): readonly Month[] {
  return [0, 1, 2].map((offset) => {
    const date: Date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1),
    );
    return { ano: date.getUTCFullYear(), mes: date.getUTCMonth() + 1 };
  });
}

export async function runDespesas(args: readonly string[]): Promise<void> {
  const options: Options = parseDespesaOptions(args);
  let database: DatabaseHandle | undefined;
  try {
    let repository: DrizzleDespesaRepository | undefined;
    let sync: SyncDespesas | undefined;
    if (options.persist) {
      const databaseUrl: string | undefined = process.env["DATABASE_URL"];
      if (databaseUrl === undefined || databaseUrl.trim() === "") {
        throw new Error("DATABASE_URL é obrigatória para usar --persist");
      }
      database = createDatabase(databaseUrl);
      repository = new DrizzleDespesaRepository(database.db);
    }

    const env = loadCamaraEnv();
    const gateway: HttpCamaraGateway = new HttpCamaraGateway(
      new CamaraHttpClient(
        new RequestScheduler(env.camaraMaxConcurrent, env.camaraMinIntervalMs),
        DEFAULT_OPTIONS,
      ),
    );
    if (repository !== undefined && database !== undefined) {
      sync = new SyncDespesas(
        gateway,
        new DrizzleRawPayloadStore(database.db),
        repository,
      );
    }

    const months: readonly Month[] =
      options.ano !== undefined && options.mes !== undefined
        ? [{ ano: options.ano, mes: options.mes }]
        : options.desde !== undefined && options.ate !== undefined
          ? monthRange(options.desde, options.ate)
          : recentMonths(new Date());
    const deputadoIds: readonly number[] =
      options.deputadoId !== undefined
        ? [options.deputadoId]
        : ((await repository?.listDeputadoIds(options.legislaturaId!)) ?? []);
    if (deputadoIds.length === 0) {
      throw new Error(
        `Nenhum deputado cadastrado para a legislatura ${options.legislaturaId}; sincronize deputados antes`,
      );
    }

    let fetched: number = 0;
    let written: number = 0;
    let unchanged: number = 0;
    let enriched: number = 0;
    let ambiguous: number = 0;
    let conflicted: number = 0;
    let pages: number = 0;
    let truncated: boolean = false;
    let samplePrinted: boolean = false;

    for (const deputadoId of deputadoIds) {
      for (const month of months) {
        let pageNumber: number = 1;
        let hasNext: boolean;
        do {
          if (sync !== undefined) {
            const result = await sync.executePage(
              deputadoId,
              options.legislaturaId!,
              month.ano,
              month.mes,
              pageNumber,
            );
            fetched += result.fetched;
            written += result.written;
            unchanged += result.unchanged;
            enriched += result.enriched;
            ambiguous += result.ambiguous;
            conflicted += result.conflicted;
            hasNext = result.hasNext;
            console.log(
              JSON.stringify({
                event: "crawler.despesas.page",
                deputadoId,
                legislaturaId: options.legislaturaId,
                ano: month.ano,
                mes: month.mes,
                page: result.page,
                fetched: result.fetched,
                written: result.written,
                unchanged: result.unchanged,
                enriched: result.enriched,
                ambiguous: result.ambiguous,
                conflicted: result.conflicted,
                hasNext,
                persist: true,
              }),
            );
          } else {
            const page: Page<DespesaDto> = await gateway.listDespesas({
              idDeputado: deputadoId,
              idLegislatura: options.legislaturaId!,
              ano: month.ano,
              mes: month.mes,
              pagina: pageNumber,
              ordem: "DESC",
            });
            const expenses: readonly Despesa[] = page.items.map((dto) =>
              mapDespesa(dto, deputadoId, options.legislaturaId!),
            );
            if (
              expenses.some(
                (expense) =>
                  expense.ano !== month.ano || expense.mes !== month.mes,
              )
            ) {
              throw new Error("A API retornou despesas fora do mês solicitado");
            }
            fetched += expenses.length;
            hasNext = page.hasNext;
            console.log(
              JSON.stringify({
                event: "crawler.despesas.page",
                deputadoId,
                legislaturaId: options.legislaturaId,
                ano: month.ano,
                mes: month.mes,
                page: page.page,
                requestKey: page.requestKey,
                fetched: page.items.length,
                validated: expenses.length,
                hasNext,
                persist: false,
              }),
            );
            if (!samplePrinted && expenses.length > 0) {
              console.log(
                JSON.stringify(
                  {
                    event: "crawler.despesas.sample",
                    source: page.items[0],
                    normalized: expenses[0],
                  },
                  null,
                  2,
                ),
              );
              samplePrinted = true;
            }
          }
          pages++;
          pageNumber++;
          if (hasNext && pageNumber > options.pageLimit) {
            truncated = true;
            break;
          }
        } while (hasNext);
        if (truncated) break;
      }
      if (truncated) break;
    }

    console.log(
      JSON.stringify({
        event: "crawler.despesas.completed",
        legislaturaId: options.legislaturaId,
        deputados: deputadoIds.length,
        months: months.length,
        pages,
        fetched,
        written,
        unchanged,
        enriched,
        ambiguous,
        conflicted,
        truncated,
        persist: options.persist,
      }),
    );
  } finally {
    await database?.pool.end();
  }
}
