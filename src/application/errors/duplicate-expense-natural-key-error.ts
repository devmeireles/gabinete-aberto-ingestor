export class DuplicateExpenseNaturalKeyError extends Error {
  constructor(key: string) {
    super(
      `A página contém despesas conflitantes com a mesma chave natural: ${key}`,
    );
    this.name = "DuplicateExpenseNaturalKeyError";
  }
}
