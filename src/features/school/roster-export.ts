/**
 * Turning a roster into a document a school office can file.
 *
 * WHY `docx` IS THE ONE DEPENDENCY. A `.docx` is a ZIP of OOXML parts; producing a real one
 * without a ZIP writer is not possible, and the alternatives the brief rules out -- `.doc`,
 * renamed HTML -- are exactly what a school would then fail to open. `docx` is purpose-built,
 * ships its own zip, and exposes the OOXML attributes Arabic actually needs (`bidirectional`
 * on the paragraph, `rightToLeft` on the run), which a hand-rolled writer would have to
 * reimplement.
 *
 * WHY THERE IS NO PDF LIBRARY. This is a deliberate refusal, not an omission. jsPDF, pdfmake
 * and @react-pdf/renderer all draw glyphs at positions; none of them performs Arabic shaping
 * or bidi reordering. Fed "قائمة التلاميذ" they emit disconnected, reversed letterforms --
 * a file that opens and is wrong, which is worse than no file. Correct Arabic needs a shaping
 * engine (HarfBuzz), and the browser already contains one. So the PDF path goes through the
 * browser's own print pipeline, where the text is laid out by the same engine that renders
 * the page, and "Save as PDF" produces a genuine, correctly-shaped PDF. See `printRoster`.
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { RosterDocumentMeta, RosterRow } from "./roster-model";

/** The two lines every generated document carries under its title. */
export interface DocumentLabels {
  generatedOn: string;
  total: string;
}

/** Column headings for the student roster, already translated by the caller. */
export interface RosterLabels extends DocumentLabels {
  number: string;
  student: string;
  group: string;
  subject: string;
  level: string;
}

/** Downloads a blob under a name. Mirrors `export-csv.ts` rather than inventing a second way. */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function text(
  value: string,
  meta: RosterDocumentMeta,
  opts: { bold?: boolean; size?: number } = {},
) {
  return new TextRun({
    text: value,
    bold: opts.bold ?? false,
    size: opts.size ?? 20, // half-points: 20 = 10pt
    // The run-level half of RTL. Without it Word lays Arabic out left-to-right inside an
    // otherwise right-to-left paragraph, which reads as scrambled punctuation.
    rightToLeft: meta.rtl,
  });
}

function line(
  value: string,
  meta: RosterDocumentMeta,
  opts: { bold?: boolean; size?: number; heading?: boolean } = {},
) {
  return new Paragraph({
    // The paragraph-level half: it sets the reading order of the whole line.
    bidirectional: meta.rtl,
    alignment: AlignmentType.CENTER,
    ...(opts.heading ? { heading: HeadingLevel.HEADING_1 } : {}),
    children: [text(value, meta, opts)],
  });
}

function cell(value: string, meta: RosterDocumentMeta, header = false) {
  return new TableCell({
    children: [
      new Paragraph({
        bidirectional: meta.rtl,
        alignment: meta.rtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [text(value, meta, { bold: header })],
      }),
    ],
  });
}

/**
 * Builds a Word document: a letterhead, then one table.
 *
 * Columns and cells arrive as plain strings, already translated and already formatted by the
 * caller. That is what lets the student roster and the teacher list share one builder -- and
 * therefore one set of RTL rules -- rather than growing a second, subtly different one that
 * drifts the first time somebody fixes a bug in only one of them.
 *
 * Exported separately from the download so a test can inspect the produced bytes without a
 * browser -- `Packer.toBuffer` works in Node, which is what makes the DOCX path verifiable.
 */
export function buildTabularDocx(
  meta: RosterDocumentMeta,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  labels: DocumentLabels,
) {
  const header = new TableRow({
    tableHeader: true, // repeats on every page, so a long list stays readable
    children: columns.map((c) => cell(c, meta, true)),
  });

  const body = rows.map(
    (cells) => new TableRow({ children: cells.map((value) => cell(value, meta)) }),
  );

  return new Document({
    sections: [
      {
        properties: {},
        children: [
          ...(meta.schoolName ? [line(meta.schoolName, meta, { bold: true, size: 28 })] : []),
          line(meta.title, meta, { heading: true, bold: true, size: 24 }),
          ...(meta.groupName ? [line(meta.groupName, meta, { bold: true })] : []),
          line(`${labels.generatedOn}: ${meta.generatedOn}`, meta, { size: 18 }),
          line(`${labels.total}: ${meta.count}`, meta, { size: 18 }),
          new Paragraph({ text: "" }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            // `visuallyRightToLeft` flips the column order itself, so the numbering column
            // sits where an Arabic reader starts rather than at the far end of the page.
            ...(meta.rtl ? { visuallyRightToLeft: true } : {}),
            rows: [header, ...body],
          }),
        ],
      },
    ],
  });
}

/** The student roster, as columns and cells. Output is unchanged from before the split. */
export function buildRosterDocx(meta: RosterDocumentMeta, rows: RosterRow[], labels: RosterLabels) {
  return buildTabularDocx(
    meta,
    [labels.number, labels.student, labels.group, labels.subject, labels.level],
    rows.map((r) => [
      String(r.index),
      r.studentName,
      r.groupName,
      r.subjectName ?? "—",
      r.levelName ?? "—",
    ]),
    labels,
  );
}

/** Builds and downloads a `.docx` from columns and cells. */
export async function exportTabularDocx(
  meta: RosterDocumentMeta,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  labels: DocumentLabels,
  filename: string,
) {
  const blob = await Packer.toBlob(buildTabularDocx(meta, columns, rows, labels));
  download(blob, filename);
}

/** Builds and downloads the student roster `.docx`. */
export async function exportRosterDocx(
  meta: RosterDocumentMeta,
  rows: RosterRow[],
  labels: RosterLabels,
  filename: string,
) {
  const blob = await Packer.toBlob(buildRosterDocx(meta, rows, labels));
  download(blob, filename);
}

/**
 * Prints the roster -- and is also the PDF path.
 *
 * The document is already in the DOM, hidden on screen and revealed by `@media print`, so
 * this only has to ask the browser to print it. Choosing "Save as PDF" in that dialog
 * produces a real PDF laid out by the browser's own text engine, which is the only way this
 * application can emit correctly shaped Arabic. See the note at the top of this file.
 */
export function printRoster() {
  window.print();
}
