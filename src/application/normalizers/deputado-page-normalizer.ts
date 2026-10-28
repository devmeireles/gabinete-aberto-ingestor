import { InvalidSourceDataError } from "@/application/errors/invalid-source-data";
import type { MappedDeputado } from "@/application/mappers/deputado-mapper";

export interface NormalizedDeputados {
  readonly items: readonly MappedDeputado[];
  readonly duplicateRecords: number;
  readonly deputadoIds: readonly number[];
}

export function normalizeDeputadoPage(
  mapped: readonly MappedDeputado[],
  previouslySeen: ReadonlySet<number> = new Set(),
): NormalizedDeputados {
  const itemsById = new Map<number, MappedDeputado>();
  let duplicateRecords = 0;

  for (const item of mapped) {
    const deputadoId: number = item.deputado.id;
    const previous: MappedDeputado | undefined = itemsById.get(deputadoId);
    if (previous !== undefined) {
      assertConsistentDeputado(previous, item);
      duplicateRecords++;
      continue;
    }
    if (previouslySeen.has(deputadoId)) {
      duplicateRecords++;
      continue;
    }
    itemsById.set(deputadoId, item);
  }

  const items: MappedDeputado[] = [...itemsById.values()];
  return {
    items,
    duplicateRecords,
    deputadoIds: items.map((item) => item.deputado.id),
  };
}

function assertConsistentDeputado(
  previous: MappedDeputado,
  current: MappedDeputado,
): void {
  if (
    previous.deputado.uri !== current.deputado.uri ||
    previous.deputado.urlFoto !== current.deputado.urlFoto ||
    previous.legislatura.siglaUf !== current.legislatura.siglaUf ||
    previous.legislatura.email !== current.legislatura.email
  ) {
    throw new InvalidSourceDataError(
      `registros repetidos do deputado ${current.deputado.id} divergem em campos de identificação ou legislatura`,
    );
  }
}
