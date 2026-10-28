import { mapPartidoDetalhe } from "@/application/mappers/partido-detalhe-mapper";
import type { PartidoGateway } from "@/application/ports/camara-gateway/partidos";
import type { PartidoRepository } from "@/application/ports/partido-repository";
import type { RawPayloadStore } from "@/application/ports/raw-payload-store";

export class EnrichPartido {
  constructor(
    private readonly gateway: PartidoGateway,
    private readonly rawStore: RawPayloadStore,
    private readonly repository: PartidoRepository,
  ) {}

  async execute(partidoId: number): Promise<void> {
    const resource = await this.gateway.getPartido(partidoId);
    const detalhe = mapPartidoDetalhe(resource.item, partidoId);
    const sourcePayloadId = await this.rawStore.save(
      resource.requestKey,
      resource.rawBody,
    );
    await this.repository.upsertDetalhe(detalhe, sourcePayloadId);
  }
}
