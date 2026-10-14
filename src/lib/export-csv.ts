/** Minimal client-side CSV export — no dependency, RTL/accents safe. */

const BOM = "﻿";

/**
 * Excel, LibreOffice and Google Sheets evaluate any cell whose first character
 * is `=`, `+`, `-`, `@`, or a leading tab/CR as a formula. A student named
 * `=HYPERLINK("http://evil","click")` would become a live link in an exported
 * roster, so prefix a single quote to force the cell to be read as text.
 */
function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function exportCsv(filename: string, rows: Record<string, string | number>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]!);
  const escape = (value: string | number) =>
    `"${neutraliseFormula(String(value)).replace(/"/g, '""')}"`;
  const csv = [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h] ?? "")).join(",")),
  ].join("\n");

  // Leading BOM so Excel detects UTF-8 and renders Arabic and accents correctly.
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
