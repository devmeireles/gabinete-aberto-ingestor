import { InvalidSourceDataError } from "@/application/errors/invalid-source-data";
import type { DeputadoHistoricoDto } from "@/application/ports/camara-gateway/deputados";
import type { DeputadoPartidoVigencia } from "@/domain/model/deputado";

interface PartyEvent {
  readonly dataHora: string;
  readonly partidoId: number | null;
}

export function mapDeputadoPartidoVigencias(
  deputadoId: number,
  legislaturaId: number,
  history: readonly DeputadoHistoricoDto[],
  knownPartidos: ReadonlyMap<number, string>,
): DeputadoPartidoVigencia[] {
  const events: PartyEvent[] = history
    .filter((item) => item.idLegislatura === legislaturaId)
    .map((item) => {
      if (item.id !== deputadoId) {
        throw new InvalidSourceDataError(
          `histórico retornou deputado ${item.id} para a consulta de ${deputadoId}`,
        );
      }
      if (!isValidDateTime(item.dataHora)) {
        throw new InvalidSourceDataError(
          `histórico do deputado ${deputadoId} contém dataHora inválida: ${String(item.dataHora)}`,
        );
      }

      const partidoId: number | null =
        item.uriPartido === null || item.uriPartido.trim() === ""
          ? null
          : extractPartidoId(item.uriPartido, deputadoId);
      if (partidoId !== null && !knownPartidos.has(partidoId)) {
        throw new InvalidSourceDataError(
          `partido ${partidoId} do histórico do deputado ${deputadoId} não foi listado na legislatura ${legislaturaId}`,
        );
      }
      return { dataHora: normalizeDateTime(item.dataHora), partidoId };
    })
    .sort((left, right) => left.dataHora.localeCompare(right.dataHora));

  const eventsByDate = new Map<string, PartyEvent>();
  for (const event of events) {
    const previous: PartyEvent | undefined = eventsByDate.get(event.dataHora);
    if (previous !== undefined && previous.partidoId !== event.partidoId) {
      throw new InvalidSourceDataError(
        `histórico do deputado ${deputadoId} tem partidos diferentes no mesmo instante ${event.dataHora}`,
      );
    }
    eventsByDate.set(event.dataHora, event);
  }

  const transitions: PartyEvent[] = [];
  for (const event of eventsByDate.values()) {
    const previous: PartyEvent | undefined = transitions.at(-1);
    if (previous === undefined || previous.partidoId !== event.partidoId) {
      transitions.push(event);
    }
  }

  return transitions.map((event, index) => ({
    deputadoId,
    legislaturaId,
    partidoId: event.partidoId,
    dataInicio: event.dataHora,
    dataFim: transitions[index + 1]?.dataHora ?? null,
  }));
}

function extractPartidoId(uri: string, deputadoId: number): number {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new InvalidSourceDataError(
      `histórico do deputado ${deputadoId} contém uriPartido inválida`,
    );
  }

  const match: RegExpMatchArray | null = parsed.pathname.match(
    /\/partidos\/(\d+)\/?$/,
  );
  const id: number = match === null ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new InvalidSourceDataError(
      `histórico do deputado ${deputadoId} contém uriPartido sem ID válido`,
    );
  }
  return id;
}

function isValidDateTime(value: string): boolean {
  const match: RegExpMatchArray | null = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/,
  );
  if (match === null) return false;

  const year: number = Number(match[1]);
  const month: number = Number(match[2]);
  const day: number = Number(match[3]);
  const hour: number = Number(match[4]);
  const minute: number = Number(match[5]);
  const second: number = Number(match[6] ?? "0");
  const daysInMonth: number = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}

function normalizeDateTime(value: string): string {
  return value.length === 16 ? `${value}:00` : value;
}
