/**
 * Sidebar integrity: what is implemented links somewhere real, what is roadmap never does.
 *
 *   node --test src/config/navigation.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dashboardNavigation, filterNavigationByRole, navigableItems } from "./navigation.ts";

const ROLES = ["admin", "teacher", "student"] as const;
const all = dashboardNavigation.flatMap((s) => s.items);
const routeTree = readFileSync(new URL("../routeTree.gen.ts", import.meta.url), "utf8");
const dictsDir = new URL("../lib/i18n/dicts/", import.meta.url);
const dictionaries = [
  readFileSync(new URL("../lib/i18n/dictionaries.ts", import.meta.url), "utf8"),
  ...readdirSync(dictsDir).map((f) => readFileSync(new URL(f, dictsDir), "utf8")),
].join("\n");

/** A route exists when the generated tree declares its full path (with or without trailing slash). */
const routeExists = (to: string) =>
  routeTree.includes(`fullPath: '${to}'`) || routeTree.includes(`fullPath: '${to}/'`);

test("no role sees two sidebar entries with the same key (the sidebar keys by `to`)", () => {
  for (const role of ROLES) {
    const tos = filterNavigationByRole(dashboardNavigation, role).flatMap((s) =>
      s.items.map((i) => i.to),
    );
    assert.equal(new Set(tos).size, tos.length, `${role}: ${tos.join(", ")}`);
  }
});

test("roadmap entries are administrator-only and never navigable", () => {
  const soon = all.filter((i) => i.comingSoon);
  assert.ok(soon.length > 0);
  for (const item of soon) {
    assert.deepEqual(item.roles, ["admin"], `${item.labelKey} must be admin-only`);
  }
  for (const role of ROLES) {
    assert.ok(
      navigableItems(role).every((i) => !i.comingSoon),
      `${role}: global search must not offer roadmap entries`,
    );
  }
});

test("roadmap entries never point at an existing route, and every active entry does", () => {
  for (const item of all) {
    if (item.comingSoon) {
      assert.equal(
        routeExists(item.to),
        false,
        `${item.labelKey} is marked Bientôt but ${item.to} exists`,
      );
    } else {
      assert.equal(
        routeExists(item.to),
        true,
        `${item.labelKey} links to ${item.to}, which has no route`,
      );
    }
  }
});

test("implemented modules are never shown as Bientôt", () => {
  for (const to of [
    "/dashboard/payments",
    "/dashboard/pricing",
    "/dashboard/hr",
    "/dashboard/programs",
    "/dashboard/resources",
    "/dashboard/attendance",
    "/dashboard/groups",
    "/dashboard/registrations",
    "/dashboard/admissions",
  ]) {
    const item = all.find((i) => i.to === to);
    assert.ok(item, `${to} must be in the sidebar`);
    assert.notEqual(item.comingSoon, true, `${to} is implemented`);
  }
});

test("finance management is live: no « Bientôt » left in Gestion financière (ADR-006)", () => {
  assert.equal(
    all.some((i) => i.labelKey === "menu.feePlans" || i.to === "/dashboard/fee-plans"),
    false,
  );
  for (const to of [
    "/dashboard/invoices",
    "/dashboard/receipts",
    "/dashboard/balances",
    "/dashboard/discounts",
    "/dashboard/reports",
  ]) {
    const item = all.find((i) => i.to === to);
    assert.ok(item, `${to} must be in the sidebar`);
    assert.notEqual(item.comingSoon, true, `${to} is implemented`);
  }
});

test("school operations are live: timetables, rooms, official documents, statistics (ADR-007)", () => {
  for (const to of [
    "/dashboard/timetables",
    "/dashboard/rooms",
    "/dashboard/official-documents",
    "/dashboard/statistics",
  ]) {
    const item = all.find((i) => i.to === to);
    assert.ok(item, `${to} must be in the sidebar`);
    assert.notEqual(item.comingSoon, true, `${to} is implemented`);
  }
});

test("pedagogy is live for administrators and teachers, never for students (ADR-008)", () => {
  for (const to of [
    "/dashboard/lesson-log",
    "/dashboard/assessments",
    "/dashboard/grades",
    "/dashboard/progression",
  ]) {
    const item = all.find((i) => i.to === to);
    assert.ok(item, `${to} must be in the sidebar`);
    assert.notEqual(item.comingSoon, true, `${to} is implemented`);
    assert.deepEqual(item.roles, ["admin", "teacher"], `${to} roles`);
    assert.ok(
      navigableItems("teacher").some((i) => i.to === to),
      `${to} reachable by a teacher`,
    );
    assert.equal(
      navigableItems("student").some((i) => i.to === to),
      false,
      `${to} hidden from students`,
    );
  }
});

test("every section and entry label exists in fr, ar and en", () => {
  const keys = [...dashboardNavigation.map((s) => s.titleKey), ...all.map((i) => i.labelKey)];
  for (const key of new Set(keys)) {
    const count = dictionaries.split(`"${key}":`).length - 1;
    assert.ok(count >= 3, `${key} appears ${count} time(s)`);
  }
});
