/**
 * Proves the exported teacher list is a real `.docx`, and that it says what the screen says.
 *
 * `Packer.toBuffer` runs in Node, so the bytes can be inspected without a browser. The
 * assertions are about the container and the OOXML actually inside it: a ZIP signature, the
 * parts Word requires, the staff names, the scope the document claims, and -- for Arabic --
 * the attributes that make Word lay the document out right-to-left. Renaming an HTML file
 * would fail the first check.
 *
 * The document is built from the same `buildTeacherRoster` and `buildTabularDocx` the page
 * calls, so a change that made the file disagree with the list on screen fails here.
 */

import JSZip from "jszip";
import { Packer } from "docx";
import { buildTabularDocx } from "../../src/features/school/roster-export.ts";
import { rosterFilename, rosterMeta } from "../../src/features/school/roster-model.ts";
import { buildTeacherRoster } from "../../src/features/school/teacher-roster-model.ts";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  ok
    ? (pass++, console.log(`PASS  ${name}`))
    : (fail++, console.log(`FAIL  ${name}  -> ${detail}`));
};

/* The wording the screen uses, in both directions. */
const FR = {
  columns: ["N°", "Enseignant", "Email", "Téléphone", "Matières", "Groupes", "Statut"],
  labels: { generatedOn: "Établie le", total: "Total" },
  title: "Liste des enseignants",
  active: "Actif",
  inactive: "Inactif",
  allStatuses: "Tous les statuts",
};
const AR = {
  columns: ["الرقم", "الأستاذ", "البريد الإلكتروني", "الهاتف", "المواد", "الأفواج", "الحالة"],
  labels: { generatedOn: "حُرّرت في", total: "المجموع" },
  title: "قائمة الأساتذة",
  active: "نشط",
  inactive: "غير نشط",
  allStatuses: "كل الحالات",
};

const source = [
  {
    teacherId: "t1",
    teacherName: "Yasmine Cherif",
    email: "yasmine@example.dz",
    phone: "0555000001",
    subjects: ["Mathématiques"],
    groupCount: 3,
    status: "active",
  },
  {
    teacherId: "t2",
    teacherName: "أحمد بن علي",
    email: null,
    phone: null,
    subjects: [],
    groupCount: 0,
    status: "active",
  },
  {
    teacherId: "t3",
    teacherName: "Karim Haddad",
    email: "karim@example.dz",
    phone: "0555000003",
    subjects: ["Physique", "Sciences"],
    groupCount: 1,
    status: "inactive",
  },
];

/** Exactly what the component does, so the test cannot drift from the control. */
const build = async (dict, locale, { status = null, search = "" } = {}) => {
  const rows = buildTeacherRoster(source, { scope: { status }, search });
  const statusLabel = (v) => (v === "active" ? dict.active : dict.inactive);
  const scopeLabel = status ? statusLabel(status) : dict.allStatuses;
  const meta = rosterMeta({
    schoolName: "مدرسة النجاح",
    title: dict.title,
    groupName: scopeLabel,
    rows,
    locale,
    today: new Date(2026, 7, 20),
  });
  const cells = rows.map((r) => [
    String(r.index),
    r.teacherName,
    r.email ?? "—",
    r.phone ?? "—",
    r.subjects || "—",
    String(r.groupCount),
    statusLabel(r.status),
  ]);
  const buf = new Uint8Array(
    await Packer.toBuffer(buildTabularDocx(meta, dict.columns, cells, dict.labels)),
  );
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml").async("string");
  return { rows, meta, buf, zip, xml, filename: rosterFilename(meta, "docx", "teachers") };
};

/** Body rows, i.e. table rows minus the repeating header. */
const bodyRows = (xml) => (xml.match(/<w:tr[ >]/g) ?? []).length - 1;

/* ------------------------------------------------------------------- the container */
console.log("\n=== CONTAINER ===");
const fr = await build(FR, "fr");

check("the file is a ZIP, not a renamed document", fr.buf[0] === 0x50 && fr.buf[1] === 0x4b);
for (const part of ["[Content_Types].xml", "word/document.xml", "word/_rels/document.xml.rels"]) {
  check(`Word's required part is present: ${part}`, fr.zip.file(part) !== null);
}

/* ---------------------------------------------------------------------- the header */
console.log("\n=== LETTERHEAD ===");
check("the school names itself on the document", fr.xml.includes("مدرسة النجاح"));
check("the document states what it is", fr.xml.includes(FR.title));
check("the document states the scope it was exported under", fr.xml.includes(FR.allStatuses));
check("the document is dated", fr.xml.includes("2026-08-20"));
check(
  "the total matches the rows",
  fr.xml.includes(`Total: ${fr.rows.length}`),
  `${fr.rows.length}`,
);

/* ---------------------------------------------------------------------- the columns */
console.log("\n=== COLUMNS ===");
for (const column of FR.columns) {
  check(`the column is printed: ${column}`, fr.xml.includes(column));
}
check(
  "one body row per teacher, and no extra",
  bodyRows(fr.xml) === source.length,
  `${bodyRows(fr.xml)} vs ${source.length}`,
);

/* ------------------------------------------------------------------------ the cells */
console.log("\n=== CELLS ===");
check(
  "every teacher appears",
  source.every((s) => fr.xml.includes(s.teacherName)),
);
check("an Arabic name survives the document intact", fr.xml.includes("أحمد بن علي"));
check(
  "contact details are printed",
  fr.xml.includes("yasmine@example.dz") && fr.xml.includes("0555000001"),
);
check("several subjects are joined into one cell", fr.xml.includes("Physique, Sciences"));
check(
  "a missing email or phone prints an em dash rather than a blank cell",
  (fr.xml.match(/—/g) ?? []).length >= 3,
  "the teacher with no email, no phone and no subject needs three",
);
check("employment status is printed in the screen's own wording", fr.xml.includes(FR.inactive));

/* ------------------------------------------------------------------------- the scope */
console.log("\n=== SCOPE ===");
const active = await build(FR, "fr", { status: "active" });
check(
  "scoping to active drops the teacher who has left",
  !active.xml.includes("Karim Haddad") && active.xml.includes("Yasmine Cherif"),
);
check("the narrowed document says so in its header", active.xml.includes(FR.active));
check("the narrowed document has one row fewer", bodyRows(active.xml) === source.length - 1);
check(
  "the narrowed total agrees with its rows",
  active.xml.includes(`Total: ${active.rows.length}`),
);

const searched = await build(FR, "fr", { search: "physique" });
check(
  "a search narrows the document to what matched",
  bodyRows(searched.xml) === 1 && searched.xml.includes("Karim Haddad"),
  `${bodyRows(searched.xml)} rows`,
);

const none = await build(FR, "fr", { search: "nobody-by-this-name" });
check("an empty selection produces a document with no body rows", bodyRows(none.xml) === 0);
check(
  "an empty document still carries its header row",
  (none.xml.match(/<w:tr[ >]/g) ?? []).length === 1,
);
check("an empty document reports a total of zero", none.xml.includes("Total: 0"));

/* --------------------------------------------------------------------------- Arabic */
console.log("\n=== ARABIC ===");
const ar = await build(AR, "ar");
check("the Arabic document is right-to-left at paragraph level", ar.xml.includes("<w:bidi"));
check("the Arabic document is right-to-left at run level", ar.xml.includes("<w:rtl"));
check("the Arabic table starts where an Arabic reader starts", ar.xml.includes("bidiVisual"));
check(
  "the Arabic column headings are used",
  AR.columns.every((c) => ar.xml.includes(c)),
);
// The French document does not merely omit the RTL attributes -- it writes them as false,
// which is stronger, because an omitted attribute would inherit whatever the reader's Word
// defaults to and an Arabic-locale Word would lay the French list out backwards.
check("the French table is not visually right-to-left", !fr.xml.includes("bidiVisual"));
check(
  "the French document states left-to-right rather than leaving it to Word",
  fr.xml.includes('<w:bidi w:val="false"/>') && fr.xml.includes('<w:rtl w:val="false"/>'),
);
check(
  "no part of the French document is marked right-to-left",
  !fr.xml.includes('<w:bidi w:val="true"') &&
    !fr.xml.includes('<w:rtl w:val="true"') &&
    !fr.xml.includes("<w:bidi/>") &&
    !fr.xml.includes("<w:rtl/>"),
);

/* ------------------------------------------------------------------------ filenames */
console.log("\n=== FILENAME ===");
// This school's name is entirely Arabic, and the slug rules strip it -- deliberately, so
// the file survives an email gateway and an older Windows share. What is left has to still
// identify the document, which is precisely what the kind token is for.
check(
  "the filename names the list, the scope and the day",
  fr.filename === "teachers-tous-les-statuts-2026-08-20.docx",
  fr.filename,
);
check(
  "an Arabic scope still yields a name that cannot collide with a student roster",
  ar.filename === "teachers-2026-08-20.docx",
  ar.filename,
);
check(
  "a school name that survives slugging is kept",
  rosterFilename({ ...fr.meta, schoolName: "Ecole Ennadjah" }, "docx", "teachers") ===
    "ecole-ennadjah-teachers-tous-les-statuts-2026-08-20.docx",
  rosterFilename({ ...fr.meta, schoolName: "Ecole Ennadjah" }, "docx", "teachers"),
);
check("the extension is .docx", fr.filename.endsWith(".docx") && ar.filename.endsWith(".docx"));

console.log(`\n${fail} FAILURES / ${pass + fail} checks`);
if (fail > 0) process.exitCode = 1;
