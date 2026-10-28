import type { DeputadoGateway } from "@/application/ports/camara-gateway/deputados";
import type { Page } from "@/application/ports/camara-gateway/page";
import type { DeputadoDto } from "@/application/ports/camara-gateway/deputados";
import type { DeputadoRepository } from "@/application/ports/deputado-repository";
import type { RawPayloadStore } from "@/application/ports/raw-payload-store";
import { mapDeputado } from "@/application/mappers/deputado-mapper";
import type { Deputado, DeputadoLegislatura } from "@/domain/model/deputado";
import type { UpsertResult } from "@/application/ports/legislatura-repository";

export interface SyncDeputadosPageResult {
  readonly page: number;
  readonly hasNext: boolean;
  readonly fetched: number;
  readonly written: number;
  readonly unchanged: number;
}

export class SyncDeputados {
  constructor(
    private readonly gateway: DeputadoGateway,
    private readonly rawStore: RawPayloadStore,
    private readonly repository: DeputadoRepository,
  ) {}

  async executePage(
    legislaturaId: number,
    pagina: number,
  ): Promise<SyncDeputadosPageResult> {
    const page: Page<DeputadoDto> = await this.gateway.listDeputados({
      idLegislatura: legislaturaId,
      pagina,
    });
    const payloadId: number = await this.rawStore.save(
      page.requestKey,
      page.rawBody,
    );
    const mapped = page.items.map((dto: DeputadoDto) =>
      mapDeputado(dto, legislaturaId),
    );
    const deputados: Deputado[] = mapped.map((item) => item.deputado);
    const memberships: DeputadoLegislatura[] = mapped.map(
      (item) => item.legislatura,
    );
    const result: UpsertResult = await this.repository.upsertMany(
      deputados,
      memberships,
      payloadId,
    );

    return {
      page: page.page,
      hasNext: page.hasNext,
      fetched: page.items.length,
      written: result.written,
      unchanged: result.unchanged,
    };
  }
}
