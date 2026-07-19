/** Serialize one value as a CSV cell. Quotes when needed, and neutralizes
 * spreadsheet formula injection: a cell that a downstream Excel/Sheets would
 * evaluate (starts with = + - @, or a tab/CR that some parsers strip to reach
 * one) is prefixed with a single quote so it renders as literal text. Fields
 * like `model`/`provider` originate from user request bodies, so treat them as
 * untrusted even though today's export is same-tenant. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minimal RFC-4180-ish CSV parser: quoted fields, embedded commas/newlines,
 * CRLF, BOM. Returns rows of trimmed cells; fully empty rows are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell.trim()); cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}
