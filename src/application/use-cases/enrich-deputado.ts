import { mapDeputadoDetalhe } from "@/application/mappers/deputado-detalhe-mapper";
import type { DeputadoGateway } from "@/application/ports/camara-gateway/deputados";
import type { DeputadoRepository } from "@/application/ports/deputado-repository";
import type { RawPayloadStore } from "@/application/ports/raw-payload-store";

export class EnrichDeputado {
  constructor(
    private readonly gateway: DeputadoGateway,
    private readonly rawStore: RawPayloadStore,
    private readonly repository: DeputadoRepository,
  ) {}

  async execute(deputadoId: number): Promise<void> {
    const resource = await this.gateway.getDeputado(deputadoId);
    const detalhe = mapDeputadoDetalhe(resource.item, deputadoId);
    const sourcePayloadId = await this.rawStore.save(
      resource.requestKey,
      resource.rawBody,
    );
    await this.repository.upsertDetalhe(detalhe, sourcePayloadId);
  }
}
