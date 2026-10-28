import type { CrawlerRunRepository } from "@/application/ports/crawler-run-repository";
import type {
  SyncDespesas,
  SyncDespesasMonthResult,
} from "@/application/use-cases/sync-despesas";
import {
  CAMARA_API_CONCURRENCY,
  inngest,
} from "@/infrastructure/inngest/client";
import { runTrackedCrawler } from "@/infrastructure/inngest/tracked-run";

const MAX_BACKFILL_MONTHS: number = 12;
const EVENT_BATCH_SIZE: number = 20;

interface Month {
  readonly ano: number;
  readonly mes: number;
}

export interface DespesasBackfillRequest {
  readonly legislaturaId: number;
  readonly desde: Month;
  readonly ate: Month;
  readonly deputadoId?: number;
}

export interface DespesasBackfillJob extends Month {
  readonly deputadoId: number;
  readonly legislaturaId: number;
  readonly eventId: string;
}

interface DespesasBackfillMonthEvent {
  readonly name: "camara/despesas.backfill.month";
  readonly id: string;
  readonly data: Omit<DespesasBackfillJob, "eventId">;
}

function parseMonth(value: unknown, field: string): Month {
  if (typeof value !== "string") {
    throw new Error(`${field} deve estar no formato AAAA-MM`);
  }
  const match: RegExpMatchArray | null = /^(\d{4})-(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`${field} deve estar no formato AAAA-MM`);
  }
  const ano: number = Number(match[1]);
  const mes: number = Number(match[2]);
  if (ano < 1900 || mes < 1 || mes > 12) {
    throw new Error(`${field} contém ano ou mês inválido`);
  }
  return { ano, mes };
}

function monthIndex(month: Month): number {
  return month.ano * 12 + month.mes - 1;
}

function monthRange(from: Month, to: Month): readonly Month[] {
  if (monthIndex(from) > monthIndex(to)) {
    throw new Error("desde deve ser anterior ou igual a ate");
  }
  const count: number = monthIndex(to) - monthIndex(from) + 1;
  if (count > MAX_BACKFILL_MONTHS) {
    throw new Error(
      `Cada backfill pode incluir no máximo ${MAX_BACKFILL_MONTHS} meses`,
    );
  }
  return Array.from({ length: count }, (_unused, offset) => {
    const index: number = monthIndex(from) + offset;
    return { ano: Math.floor(index / 12), mes: (index % 12) + 1 };
  });
}

export function parseDespesasBackfillRequest(
  data: Readonly<Record<string, unknown>>,
): DespesasBackfillRequest {
  const legislaturaId: unknown = data["legislaturaId"];
  if (
    typeof legislaturaId !== "number" ||
    !Number.isInteger(legislaturaId) ||
    legislaturaId <= 0
  ) {
    throw new Error("Informe legislaturaId como inteiro positivo");
  }
  const desde: Month = parseMonth(data["desde"], "desde");
  const ate: Month = parseMonth(data["ate"], "ate");
  monthRange(desde, ate);

  const requestedDeputy: unknown = data["deputadoId"];
  if (
    requestedDeputy !== undefined &&
    (typeof requestedDeputy !== "number" ||
      !Number.isInteger(requestedDeputy) ||
      requestedDeputy <= 0)
  ) {
    throw new Error("deputadoId deve ser um inteiro positivo");
  }
  return {
    legislaturaId,
    desde,
    ate,
    ...(requestedDeputy === undefined ? {} : { deputadoId: requestedDeputy }),
  };
}

export function createDespesasBackfillJobs(
  request: DespesasBackfillRequest,
  deputadoIds: readonly number[],
  runId: string,
): readonly DespesasBackfillJob[] {
  const months: readonly Month[] = monthRange(request.desde, request.ate);
  return deputadoIds.flatMap((deputadoId) =>
    months.map((month) => ({
      ...month,
      deputadoId,
      legislaturaId: request.legislaturaId,
      eventId: `despesas-backfill-${runId}-${deputadoId}-${month.ano}-${month.mes}`,
    })),
  );
}

export function createBackfillDespesasFunction(
  useCase: SyncDespesas,
  runRepository: CrawlerRunRepository,
) {
  const dispatcher = inngest.createFunction(
    {
      id: "backfill-despesas",
      triggers: [{ event: "camara/despesas.backfill" }],
      retries: 5,
      concurrency: { limit: 1, key: '"backfill-despesas"', scope: "env" },
      singleton: { mode: "skip" },
    },
    async ({ step, runId, attempt, event }) =>
      runTrackedCrawler(
        runRepository,
        "backfill-despesas",
        { runId, attempt, eventName: event.name },
        async () => {
          const request: DespesasBackfillRequest = parseDespesasBackfillRequest(
            event.data,
          );
          const registeredDeputies: readonly number[] = await step.run(
            `backfill-deputados-legislatura-${request.legislaturaId}`,
            () => useCase.listDeputadoIds(request.legislaturaId),
          );
          const deputadoIds: readonly number[] =
            request.deputadoId === undefined
              ? registeredDeputies
              : registeredDeputies.includes(request.deputadoId)
                ? [request.deputadoId]
                : [];
          if (deputadoIds.length === 0) {
            throw new Error(
              request.deputadoId === undefined
                ? `Nenhum deputado cadastrado para a legislatura ${request.legislaturaId}`
                : `Deputado ${request.deputadoId} não está cadastrado na legislatura ${request.legislaturaId}`,
            );
          }

          const jobs: readonly DespesasBackfillJob[] =
            createDespesasBackfillJobs(request, deputadoIds, runId);
          for (
            let offset: number = 0;
            offset < jobs.length;
            offset += EVENT_BATCH_SIZE
          ) {
            const batch: readonly DespesasBackfillJob[] = jobs.slice(
              offset,
              offset + EVENT_BATCH_SIZE,
            );
            const events: DespesasBackfillMonthEvent[] = batch.map(
              ({ eventId, ...job }) => ({
                id: eventId,
                name: "camara/despesas.backfill.month",
                data: job,
              }),
            );
            await step.sendEvent(
              `backfill-despesas-lote-${Math.floor(offset / EVENT_BATCH_SIZE) + 1}`,
              events,
            );
          }

          return {
            legislaturaId: request.legislaturaId,
            deputados: deputadoIds.length,
            monthsPerDeputy: monthRange(request.desde, request.ate).length,
            jobsQueued: jobs.length,
            desde: `${request.desde.ano}-${String(request.desde.mes).padStart(2, "0")}`,
            ate: `${request.ate.ano}-${String(request.ate.mes).padStart(2, "0")}`,
          };
        },
      ),
  );

  const worker = inngest.createFunction(
    {
      id: "backfill-despesas-month",
      triggers: [{ event: "camara/despesas.backfill.month" }],
      retries: 5,
      concurrency: CAMARA_API_CONCURRENCY,
    },
    async ({ step, runId, attempt, event }): Promise<SyncDespesasMonthResult> =>
      runTrackedCrawler(
        runRepository,
        "backfill-despesas-month",
        { runId, attempt, eventName: event.name },
        async () => {
          const { deputadoId, legislaturaId, ano, mes } = event.data;
          if (
            !Number.isInteger(deputadoId) ||
            deputadoId <= 0 ||
            !Number.isInteger(legislaturaId) ||
            legislaturaId <= 0 ||
            !Number.isInteger(ano) ||
            ano < 1900 ||
            !Number.isInteger(mes) ||
            mes < 1 ||
            mes > 12
          ) {
            throw new Error(
              "Payload inválido para camara/despesas.backfill.month",
            );
          }
          return step.run(`despesas-deputado-${deputadoId}-${ano}-${mes}`, () =>
            useCase.executeDeputadoMonth(deputadoId, legislaturaId, ano, mes),
          );
        },
      ),
  );

  return [dispatcher, worker];
}
