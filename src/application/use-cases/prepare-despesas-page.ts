import { mapDespesa } from "@/application/mappers/despesa-mapper";
import type { DespesaDto } from "@/application/ports/camara-gateway/despesas";
import type { RejectedDespesa } from "@/application/ports/despesa-repository";
import type { Despesa } from "@/domain/model/despesa";

export function prepareDespesasPage(
  items: readonly DespesaDto[],
  deputadoId: number,
  legislaturaId: number,
  ano: number,
  mes: number,
): { expenses: readonly Despesa[]; rejectedItems: readonly RejectedDespesa[] } {
  if (items.some((item) => item.ano !== ano || item.mes !== mes)) {
    throw new Error(
      `A API retornou despesas fora do período ${ano}-${String(mes).padStart(2, "0")}`,
    );
  }
  const expenses: Despesa[] = [];
  const rejectedItems: RejectedDespesa[] = [];
  for (const dto of items) {
    if (dto.codDocumento === null || dto.codDocumento.trim() === "") {
      rejectedItems.push({
        payload: { ...dto, deputadoId, legislaturaId },
        reason: "missing_document_code",
      });
      continue;
    }
    expenses.push(mapDespesa(dto, deputadoId, legislaturaId));
  }
  return { expenses, rejectedItems };
}
