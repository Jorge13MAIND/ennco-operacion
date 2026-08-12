const spreadsheetFormulaPrefix = /^[\s]*[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (spreadsheetFormulaPrefix.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
