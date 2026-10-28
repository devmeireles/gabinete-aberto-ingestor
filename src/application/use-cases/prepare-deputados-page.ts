import type {
  DeputadoGateway,
  DeputadoHistoricoDto,
  DeputadoDto,
} from "@/application/ports/camara-gateway/deputados";
import type { Page } from "@/application/ports/camara-gateway/page";
import { mapDeputado } from "@/application/mappers/deputado-mapper";
import { mapDeputadoPartidoVigencias } from "@/application/mappers/deputado-partido-historico-mapper";
import { normalizeDeputadoPage } from "@/application/normalizers/deputado-page-normalizer";
import type { MappedDeputado } from "@/application/mappers/deputado-mapper";
import type { DeputadoPartidoVigencia } from "@/domain/model/deputado";

export interface PreparedDeputadoHistorico {
  readonly deputadoId: number;
  readonly legislaturaId: number;
  readonly vigencias: readonly DeputadoPartidoVigencia[];
  readonly requestKey: string;
  readonly rawBody: unknown;
}

export interface PreparedDeputadosPage {
  readonly page: number;
  readonly hasNext: boolean;
  readonly fetched: number;
  readonly duplicateRecords: number;
  readonly deputados: readonly MappedDeputado[];
  readonly deputadoIds: readonly number[];
  readonly requestKey: string;
  readonly rawBody: unknown;
  readonly historicos: readonly PreparedDeputadoHistorico[];
}

export interface DeputadoHistoryProgress {
  readonly stage: "started" | "completed" | "failed";
  readonly completed: number;
  readonly total: number;
  readonly deputadoId?: number;
  readonly error?: unknown;
}

export class PrepareDeputadosPage {
  constructor(private readonly gateway: DeputadoGateway) {}

  async execute(
    legislaturaId: number,
    pagina: number,
    knownPartidos: ReadonlyMap<number, string>,
    previouslySeen: ReadonlySet<number> = new Set(),
    onHistoryProgress?: (progress: DeputadoHistoryProgress) => void,
  ): Promise<PreparedDeputadosPage> {
    const page: Page<DeputadoDto> = await this.gateway.listDeputados({
      idLegislatura: legislaturaId,
      pagina,
    });
    const normalized = normalizeDeputadoPage(
      page.items.map((dto) => mapDeputado(dto, legislaturaId)),
      previouslySeen,
    );
    const total: number = normalized.items.length;
    let completed: number = 0;
    onHistoryProgress?.({ stage: "started", completed, total });
    const historicos: PreparedDeputadoHistorico[] = await Promise.all(
      normalized.items.map(async ({ deputado }) => {
        try {
          const historyPage: Page<DeputadoHistoricoDto> =
            await this.gateway.getDeputadoHistorico(deputado.id);
          const prepared: PreparedDeputadoHistorico = {
            deputadoId: deputado.id,
            legislaturaId,
            vigencias: mapDeputadoPartidoVigencias(
              deputado.id,
              legislaturaId,
              historyPage.items,
              knownPartidos,
            ),
            requestKey: historyPage.requestKey,
            rawBody: historyPage.rawBody,
          };
          completed++;
          onHistoryProgress?.({
            stage: "completed",
            completed,
            total,
            deputadoId: deputado.id,
          });
          return prepared;
        } catch (error: unknown) {
          onHistoryProgress?.({
            stage: "failed",
            completed,
            total,
            deputadoId: deputado.id,
            error,
          });
          throw error;
        }
      }),
    );

    return {
      page: page.page,
      hasNext: page.hasNext,
      fetched: page.items.length,
      duplicateRecords: normalized.duplicateRecords,
      deputados: normalized.items,
      deputadoIds: normalized.deputadoIds,
      requestKey: page.requestKey,
      rawBody: page.rawBody,
      historicos,
    };
  }
}
