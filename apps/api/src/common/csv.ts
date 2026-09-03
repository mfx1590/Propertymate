/**
 * Minimal RFC 4180 CSV writing for admin exports (Plan §6.7 / §10.2 Phase 3).
 *
 * Two details that matter more than the quoting:
 *
 * **The UTF-8 BOM.** Excel, which is where every one of these files is going
 * to be opened, assumes the system code page for a bare .csv and turns every
 * Turkish ı/ş/ğ, every Cyrillic and every Farsi character into mojibake. The
 * three-byte BOM at the front is the only signal it honours.
 *
 * **Formula neutralisation.** A cell beginning with `=`, `+`, `-` or `@` is
 * executed by spreadsheet software on open. Listing titles and dispute reasons
 * are user-typed, so an export is exactly the vector for an `=HYPERLINK(...)`
 * payload aimed at an admin. Such cells are prefixed with an apostrophe, which
 * Excel treats as "literal text" and strips on display.
 */
export const CSV_BOM = '﻿';

const FORMULA_LEADERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * A cell that is nothing but a signed number, or an E.164 phone, cannot be an
 * executable formula — there is no operator or function in it for Excel to
 * run. Guarding those would corrupt every phone (`'+9053…`) and every
 * reversal in the payment ledger (`'-120`) to defend against nothing.
 */
const HARMLESS = /^(?:[+-]?\d+(?:\.\d+)?|\+\d{6,15})$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);

  if (text.length > 0 && FORMULA_LEADERS.has(text[0]) && !HARMLESS.test(text)) text = `'${text}`;

  // Quote when the cell contains a delimiter, a quote, or a line break; a
  // quote inside is doubled. Everything else is emitted bare.
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}
