import { mapDeputadoDetalhe } from "@/application/mappers/deputado-detalhe-mapper";
import type { DeputadoGateway } from "@/application/ports/camara-gateway/deputados";
import type { DeputadoRepository } from "@/application/ports/deputado-repository";

export class EnrichDeputado {
  constructor(
    private readonly gateway: DeputadoGateway,
    private readonly repository: DeputadoRepository,
  ) {}

  async execute(deputadoId: number): Promise<void> {
    const resource = await this.gateway.getDeputado(deputadoId);
    const detalhe = mapDeputadoDetalhe(resource.item, deputadoId);
    await this.repository.upsertDetalhe(detalhe);
  }
}
