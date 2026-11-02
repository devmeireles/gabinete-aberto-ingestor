export function selectBilheteYears(
  requestedYear: unknown,
  currentYear: number,
): readonly number[] {
  if (requestedYear === undefined) {
    return Array.from(
      { length: currentYear - 2008 + 1 },
      (_, index) => 2008 + index,
    );
  }
  if (
    typeof requestedYear !== "number" ||
    !Number.isInteger(requestedYear) ||
    requestedYear < 2008 ||
    requestedYear > currentYear
  ) {
    throw new Error(`Informe ano como inteiro entre 2008 e ${currentYear}`);
  }
  return [requestedYear];
}
