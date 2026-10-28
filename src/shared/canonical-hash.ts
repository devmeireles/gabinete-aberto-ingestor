import { createHash } from "node:crypto";

/**
 * JSON canônico: chaves ordenadas, sem espaços. Por quê: o hash precisa
 * depender só do CONTEÚDO. Se a API reordenar as chaves de um objeto, o hash
 * não pode mudar, senão geraríamos "mudanças" falsas na camada raw.
 *
 * Arrays mantêm a ordem (aqui ela é significativa e a consulta é ordenada).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item)).join(",")}]`;
  }
  const entries: Array<[string, unknown]> = Object.entries(
    value as Record<string, unknown>,
  )
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body: string = entries
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`)
    .join(",");
  return `{${body}}`;
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
