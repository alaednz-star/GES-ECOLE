/**
 * The printed page, for any list this application prints.
 *
 * Present in the DOM at all times and hidden on screen, rather than opened in a new window:
 * a popup would lose the branding context and the resolved school colours, and would be
 * blocked by default in most browsers. `@media print` in `styles.css` hides the application
 * shell and reveals only this.
 *
 * It takes columns and cells rather than a roster, for the same reason `buildTabularDocx`
 * does: the student roster and the teacher list must print through one component, so that
 * fixing the letterhead, the RTL direction or the page break fixes it in both places at once.
 */

import type { DocumentLabels } from "./roster-export";
import type { RosterDocumentMeta } from "./roster-model";

export interface PrintColumn {
  label: string;
  /** Right-aligned digits that stay in column. Used for the numbering column. */
  numeric?: boolean;
}

export interface PrintRow {
  key: string;
  cells: string[];
}

export function RosterPrintDocument({
  meta,
  columns,
  rows,
  labels,
  logoUrl,
}: {
  meta: RosterDocumentMeta;
  columns: PrintColumn[];
  rows: PrintRow[];
  labels: DocumentLabels;
  logoUrl: string | null;
}) {
  return (
    <section
      data-roster-print=""
      dir={meta.rtl ? "rtl" : "ltr"}
      aria-hidden
      className="hidden print:block"
    >
      <header className="mb-4 border-b border-black/40 pb-3 text-center">
        {logoUrl && (
          /* The school's own mark, at letterhead size. `alt=""` because the name is printed
             directly beneath it. */
          <img src={logoUrl} alt="" className="mx-auto mb-2 h-16 w-auto object-contain" />
        )}
        {meta.schoolName && <p className="text-lg font-bold">{meta.schoolName}</p>}
        <h1 className="mt-1 text-xl font-bold">{meta.title}</h1>
        {meta.groupName && <p className="mt-1 text-base">{meta.groupName}</p>}
        <p className="mt-1 text-xs">
          {labels.generatedOn}: {meta.generatedOn} · {labels.total}: {meta.count}
        </p>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.label}
                className="border border-black/40 px-2 py-1 text-start font-semibold"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((value, i) => (
                <td
                  key={columns[i]?.label ?? i}
                  className={
                    columns[i]?.numeric
                      ? "border border-black/30 px-2 py-1 tabular-nums"
                      : "border border-black/30 px-2 py-1"
                  }
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
