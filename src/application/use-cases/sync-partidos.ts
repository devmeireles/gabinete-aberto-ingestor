import type {
  PartidoDto,
  PartidoGateway,
} from "@/application/ports/camara-gateway/partidos";
import type { Page } from "@/application/ports/camara-gateway/page";
import type { PartidoRepository } from "@/application/ports/partido-repository";
import type { UpsertResult } from "@/application/ports/legislatura-repository";
import type { RawPayloadStore } from "@/application/ports/raw-payload-store";
import { mapPartido } from "@/application/mappers/partido-mapper";
import type { Partido, PartidoLegislatura } from "@/domain/model/partido";

export interface SyncPartidosPageResult {
  readonly page: number;
  readonly hasNext: boolean;
  readonly fetched: number;
  readonly written: number;
  readonly unchanged: number;
  readonly partidos: readonly { readonly id: number; readonly sigla: string }[];
}

export class SyncPartidos {
  constructor(
    private readonly gateway: PartidoGateway,
    private readonly rawStore: RawPayloadStore,
    private readonly repository: PartidoRepository,
  ) {}

  async executePage(
    legislaturaId: number,
    pagina: number,
  ): Promise<SyncPartidosPageResult> {
    const page: Page<PartidoDto> = await this.gateway.listPartidos({
      idLegislatura: legislaturaId,
      pagina,
    });
    const payloadId: number = await this.rawStore.save(
      page.requestKey,
      page.rawBody,
    );
    const mapped = page.items.map((dto: PartidoDto) =>
      mapPartido(dto, legislaturaId),
    );
    const partidos: Partido[] = mapped.map((item) => item.partido);
    const memberships: PartidoLegislatura[] = mapped.map(
      (item) => item.legislatura,
    );
    const result: UpsertResult = await this.repository.upsertMany(
      partidos,
      memberships,
      payloadId,
    );

    return {
      page: page.page,
      hasNext: page.hasNext,
      fetched: page.items.length,
      written: result.written,
      unchanged: result.unchanged,
      partidos: partidos.map((partido) => ({
        id: partido.id,
        sigla: partido.sigla,
      })),
    };
  }
}
