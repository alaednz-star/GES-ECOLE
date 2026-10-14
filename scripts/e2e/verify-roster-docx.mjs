/**
 * Proves the exported Word file is a real `.docx`, not a renamed anything.
 *
 * `Packer.toBuffer` runs in Node, so the bytes can be inspected without a browser. The
 * assertions are about the container and the OOXML actually inside it: a ZIP signature, the
 * parts Word requires, the student names, and -- for Arabic -- the two attributes that make
 * Word lay the document out right-to-left. Renaming an HTML file would fail the first check.
 */

import assert from "node:assert/strict";
import JSZip from "jszip";
import { Packer } from "docx";
import { buildRosterDocx } from "../../src/features/school/roster-export.ts";
import { buildRoster, rosterMeta } from "../../src/features/school/roster-model.ts";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  ok
    ? (pass++, console.log(`PASS  ${name}`))
    : (fail++, console.log(`FAIL  ${name}  -> ${detail}`));
};

const labels = {
  number: "N°",
  student: "Élève",
  group: "Groupe",
  subject: "Matière",
  level: "Niveau",
  generatedOn: "Établie le",
  total: "Total",
};

const source = [
  {
    studentId: "s1",
    studentName: "Ahmed Benali",
    groupId: "g1",
    groupName: "Maths A",
    subjectName: "Mathématiques",
    levelName: "3AS",
    status: "approved",
  },
  {
    studentId: "s2",
    studentName: "ياسمين شريف",
    groupId: "g1",
    groupName: "Maths A",
    subjectName: "رياضيات",
    levelName: "3AS",
    status: "approved",
  },
];

async function docxParts(locale, groupName) {
  const rows = buildRoster(source, { scope: { groupId: groupName ? "g1" : null } });
  const meta = rosterMeta({
    schoolName: "مدرسة النجاح",
    title: locale === "ar" ? "قائمة التلاميذ" : "Liste des élèves",
    groupName,
    rows,
    locale,
    today: new Date(2026, 7, 20),
  });
  const buffer = await Packer.toBuffer(buildRosterDocx(meta, rows, labels));
  return { buffer: new Uint8Array(buffer), meta, rows };
}

console.log("--- the container is a real Office Open XML package ---");
const fr = await docxParts("fr", "Maths A");
check(
  "starts with the ZIP local-file signature PK\\x03\\x04",
  fr.buffer[0] === 0x50 && fr.buffer[1] === 0x4b && fr.buffer[2] === 0x03 && fr.buffer[3] === 0x04,
  [...fr.buffer.slice(0, 4)].join(","),
);

const zip = await JSZip.loadAsync(fr.buffer);
const names = Object.keys(zip.files);
check("contains [Content_Types].xml", names.includes("[Content_Types].xml"), names.join(", "));
check("contains word/document.xml", names.includes("word/document.xml"), names.join(", "));
check(
  "contains the package relationships",
  names.some((n) => n.startsWith("_rels/")),
  names.join(", "),
);

const documentXml = await zip.file("word/document.xml").async("string");

console.log("\n--- the document says what the roster says ---");
check("the school is named", documentXml.includes("مدرسة النجاح"));
check("the title is present", documentXml.includes("Liste des élèves"));
check("the group is named", documentXml.includes("Maths A"));
check("the generation date is present", documentXml.includes("2026-08-20"));
check(
  "the total matches the row count",
  documentXml.includes(`Total: ${fr.rows.length}`),
  `rows=${fr.rows.length}`,
);
check(
  "every student appears",
  source.every((s) => documentXml.includes(s.studentName)),
);
check("a Latin name survives encoding", documentXml.includes("Ahmed Benali"));
check("an Arabic name survives encoding", documentXml.includes("ياسمين شريف"));

console.log("\n--- Arabic is configured right-to-left, not merely translated ---");
const ar = await docxParts("ar", "Maths A");
const arXml = await (await JSZip.loadAsync(ar.buffer)).file("word/document.xml").async("string");
check("the Arabic document is flagged RTL in its metadata", ar.meta.rtl === true);
check("paragraphs carry w:bidi", arXml.includes("w:bidi"), "paragraph-level reading order");
check("runs carry w:rtl", arXml.includes("w:rtl"), "run-level direction");
check("the table is visually right-to-left", arXml.includes("bidiVisual"), "column order flipped");
check("the Arabic title is used", arXml.includes("قائمة التلاميذ"));

console.log("\n--- a French document is NOT marked right-to-left ---");
check("no bidiVisual in the French document", !documentXml.includes("bidiVisual"));
check("French metadata is not RTL", fr.meta.rtl === false);

console.log("\n--- an empty roster still produces a valid document ---");
const emptyRows = buildRoster([], { scope: { groupId: null } });
const emptyMeta = rosterMeta({
  schoolName: "S",
  title: "T",
  groupName: null,
  rows: emptyRows,
  locale: "fr",
});
const emptyBuf = new Uint8Array(
  await Packer.toBuffer(buildRosterDocx(emptyMeta, emptyRows, labels)),
);
check("empty roster is still a ZIP", emptyBuf[0] === 0x50 && emptyBuf[1] === 0x4b);
const emptyXml = await (await JSZip.loadAsync(emptyBuf)).file("word/document.xml").async("string");
check("empty roster reports a total of 0", emptyXml.includes("Total: 0"));

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
if (fail > 0) process.exitCode = 1;
