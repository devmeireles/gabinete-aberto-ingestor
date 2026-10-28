export function currentDateInBrazil(now: Date = new Date()): string {
  const parts: Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values: Map<string, string> = new Map(
    parts.map(({ type, value }) => [type, value]),
  );
  const year: string | undefined = values.get("year");
  const month: string | undefined = values.get("month");
  const day: string | undefined = values.get("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("Não foi possível determinar a data atual de Brasília");
  }
  return `${year}-${month}-${day}`;
}
