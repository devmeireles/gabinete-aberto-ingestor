import { describe, expect, it } from "vitest";
import { mapLegislatura } from "@/application/mappers/legislatura-mapper";

describe("mapLegislatura", () => {
  const dto = {
    id: 57,
    uri: "https://dadosabertos.camara.leg.br/api/v2/legislaturas/57",
    dataInicio: "2023-02-01",
    dataFim: "2027-01-31",
  };

  it("marks the legislature current when the date is within its inclusive range", () => {
    expect(mapLegislatura(dto, "2023-02-01").legislaturaAtual).toBe(true);
    expect(mapLegislatura(dto, "2027-01-31").legislaturaAtual).toBe(true);
    expect(mapLegislatura(dto, "2027-02-01").legislaturaAtual).toBe(false);
  });
});
