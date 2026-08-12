export type CsvTable = {
  columns: string[];
  rows: Record<string, string>[];
};

export function parseCsv(csv: string): CsvTable {
  const input = csv.startsWith("\uFEFF") ? csv.slice(1) : csv;
  const parsedRows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    const next = input[index + 1];
    if (inQuotes) {
      if (character === '"' && next === '"') {
        currentCell += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        currentCell += character;
      }
      continue;
    }
    if (character === '"') {
      if (currentCell.length > 0) throw new Error("CSV_QUOTE_POSITION_INVALID");
      inQuotes = true;
    } else if (character === ",") {
      currentRow.push(currentCell);
      currentCell = "";
    } else if (character === "\r" && next === "\n") {
      currentRow.push(currentCell);
      parsedRows.push(currentRow);
      currentRow = [];
      currentCell = "";
      index += 1;
    } else if (character === "\n") {
      currentRow.push(currentCell);
      parsedRows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += character;
    }
  }
  if (inQuotes) throw new Error("CSV_UNCLOSED_QUOTE");
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    parsedRows.push(currentRow);
  }
  if (parsedRows.length === 0) throw new Error("CSV_EMPTY");

  const columns = parsedRows[0]!;
  if (columns.length === 0 || columns.some((column) => !column)) throw new Error("CSV_HEADER_INVALID");
  if (new Set(columns).size !== columns.length) throw new Error("CSV_DUPLICATE_HEADER");

  const rows = parsedRows.slice(1).filter((record) => !(record.length === 1 && record[0] === "")).map((record) => {
    if (record.length !== columns.length) throw new Error("CSV_COLUMN_COUNT_MISMATCH");
    return Object.fromEntries(columns.map((column, index) => [column, record[index] ?? ""]));
  });
  return { columns, rows };
}
