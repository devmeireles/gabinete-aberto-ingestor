import type { DeputadoRepository } from "@/application/ports/deputado-repository";
import type { RawPayloadStore } from "@/application/ports/raw-payload-store";
import type { UpsertResult } from "@/application/ports/legislatura-repository";
import type {
  DeputadoHistoryProgress,
  PrepareDeputadosPage,
} from "@/application/use-cases/prepare-deputados-page";

export interface SyncDeputadosPageResult {
  readonly page: number;
  readonly hasNext: boolean;
  readonly fetched: number;
  readonly validated: number;
  readonly duplicateRecords: number;
  readonly partyAffiliations: number;
  readonly deputadoIds: readonly number[];
  readonly written: number;
  readonly unchanged: number;
}

export class SyncDeputados {
  constructor(
    private readonly preparePage: PrepareDeputadosPage,
    private readonly rawStore: RawPayloadStore,
    private readonly repository: DeputadoRepository,
  ) {}

  async executePage(
    legislaturaId: number,
    pagina: number,
    knownPartidos: ReadonlyMap<number, string>,
    previouslySeen: ReadonlySet<number> = new Set(),
    onHistoryProgress?: (progress: DeputadoHistoryProgress) => void,
  ): Promise<SyncDeputadosPageResult> {
    const prepared = await this.preparePage.execute(
      legislaturaId,
      pagina,
      knownPartidos,
      previouslySeen,
      onHistoryProgress,
    );
    const sourcePayloadId: number = await this.rawStore.save(
      prepared.requestKey,
      prepared.rawBody,
    );
    const historicos = await Promise.all(
      prepared.historicos.map(async (history) => ({
        deputadoId: history.deputadoId,
        legislaturaId: history.legislaturaId,
        vigencias: history.vigencias,
        sourcePayloadId: await this.rawStore.save(
          history.requestKey,
          history.rawBody,
        ),
      })),
    );
    const result: UpsertResult = await this.repository.syncPage({
      deputados: prepared.deputados.map((item) => item.deputado),
      legislaturas: prepared.deputados.map((item) => item.legislatura),
      sourcePayloadId,
      historicos,
    });

    return {
      page: prepared.page,
      hasNext: prepared.hasNext,
      fetched: prepared.fetched,
      validated: prepared.deputados.length,
      duplicateRecords: prepared.duplicateRecords,
      partyAffiliations: historicos.reduce(
        (count, history) => count + history.vigencias.length,
        0,
      ),
      deputadoIds: prepared.deputadoIds,
      written: result.written,
      unchanged: result.unchanged,
    };
  }
}
