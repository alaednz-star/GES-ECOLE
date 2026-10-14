/**
 * Visibility and the header counters.
 *
 * `visibilityOf` is where the two-column model (`is_published` + `published_at`) becomes
 * the three states the product talks about. It is the rule that decides whether a student
 * can see something, so "scheduled" being read as "published" is a disclosure bug, not a
 * cosmetic one -- the boundary around "now" is tested from both sides.
 *
 * `statsFor` only counts, but it counts what the teacher's header reports, and a
 * miscount there is invisible until someone reconciles it by hand.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  visibilityOf,
  statsFor,
  compareChapters,
  type ChapterRow,
  type CourseResources,
  type ResourceRow,
} from "./types.ts";

const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/* ------------------------------------------------------------------ visibilityOf */

test("unpublished is hidden, whatever the date says", () => {
  assert.equal(visibilityOf(false, null), "hidden");
  assert.equal(visibilityOf(false, iso(-HOUR)), "hidden");
  assert.equal(visibilityOf(false, iso(+HOUR)), "hidden", "a future date cannot publish it");
});

test("published with no date is live", () => {
  assert.equal(visibilityOf(true, null), "published");
});

test("published with a past date is live", () => {
  assert.equal(visibilityOf(true, iso(-HOUR)), "published");
  assert.equal(visibilityOf(true, iso(-365 * 24 * HOUR)), "published");
});

test("published with a future date is scheduled, NOT visible", () => {
  // The disclosure case: reading this as "published" would show unreleased material.
  assert.equal(visibilityOf(true, iso(+HOUR)), "scheduled");
  assert.equal(visibilityOf(true, iso(+365 * 24 * HOUR)), "scheduled");
});

test("the boundary is strict: a date already passed is published", () => {
  assert.equal(visibilityOf(true, iso(-1000)), "published");
});

test("a malformed date is treated as live rather than hiding the resource", () => {
  // `new Date("nonsense") > new Date()` is false, so the row stays published. Asserted so
  // the behaviour is a decision on record rather than an accident of comparison.
  assert.equal(visibilityOf(true, "not-a-date"), "published");
});

/* ------------------------------------------------------------------ statsFor */

const resource = (over: Partial<ResourceRow> = {}): ResourceRow =>
  ({
    id: "r",
    chapterId: "c",
    groupId: "g",
    title: "t",
    description: null,
    kind: "file",
    storagePath: null,
    url: null,
    mimeType: null,
    sizeBytes: null,
    position: 0,
    role: "extra",
    linkProvider: null,
    linkThumbnailUrl: null,
    pinned: false,
    allowDownload: true,
    isPublished: true,
    publishedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    visibility: "published",
    ...over,
  }) as ResourceRow;

const course = (chapters: { resources: ResourceRow[] }[]): CourseResources =>
  ({ chapters }) as unknown as CourseResources;

test("statsFor: nothing at all is all zeros, not NaN", () => {
  assert.deepEqual(statsFor([]), {
    chapters: 0,
    resources: 0,
    published: 0,
    scheduled: 0,
    hidden: 0,
    storageBytes: 0,
  });
});

test("statsFor: a course of empty chapters counts the chapters and no resources", () => {
  const s = statsFor([course([{ resources: [] }, { resources: [] }])]);
  assert.equal(s.chapters, 2);
  assert.equal(s.resources, 0);
  assert.equal(s.storageBytes, 0);
});

test("statsFor: each visibility lands in exactly one bucket", () => {
  const s = statsFor([
    course([
      {
        resources: [
          resource({ visibility: "published" }),
          resource({ visibility: "published" }),
          resource({ visibility: "scheduled" }),
          resource({ visibility: "hidden" }),
        ],
      },
    ]),
  ]);
  assert.equal(s.resources, 4);
  assert.equal(s.published, 2);
  assert.equal(s.scheduled, 1);
  assert.equal(s.hidden, 1);
  assert.equal(s.published + s.scheduled + s.hidden, s.resources, "buckets must total");
});

test("statsFor: sums bytes and treats a link's null size as zero", () => {
  const s = statsFor([
    course([
      {
        resources: [
          resource({ sizeBytes: 1000 }),
          resource({ sizeBytes: 24 }),
          resource({ kind: "link", sizeBytes: null }),
        ],
      },
    ]),
  ]);
  assert.equal(s.storageBytes, 1024);
  assert.equal(s.resources, 3);
});

test("statsFor: adds up across several courses and chapters", () => {
  const s = statsFor([
    course([{ resources: [resource()] }, { resources: [resource({ visibility: "hidden" })] }]),
    course([{ resources: [resource({ visibility: "scheduled" }), resource()] }]),
  ]);
  assert.equal(s.chapters, 3);
  assert.equal(s.resources, 4);
  assert.equal(s.published, 2);
  assert.equal(s.scheduled, 1);
  assert.equal(s.hidden, 1);
});

/* ------------------------------------------------------------------ compareChapters */

const chapter = (over: Partial<ChapterRow>): ChapterRow =>
  ({ id: "c", groupId: "g", title: "T", position: 0, pinned: false, ...over }) as ChapterRow;

test("compareChapters: pinned chapters come first", () => {
  const pinned = chapter({ id: "p", pinned: true, position: 9 });
  const plain = chapter({ id: "n", pinned: false, position: 0 });
  assert.ok(compareChapters(pinned, plain) < 0, "pinned wins even with a later position");
  assert.ok(compareChapters(plain, pinned) > 0);
});

test("compareChapters: within the same pin state, position decides", () => {
  const a = chapter({ id: "a", position: 0 });
  const b = chapter({ id: "b", position: 1 });
  assert.ok(compareChapters(a, b) < 0);
  assert.ok(compareChapters(b, a) > 0);
});

test("compareChapters: sorting a list is stable and pin-first", () => {
  const list = [
    chapter({ id: "b", position: 1 }),
    chapter({ id: "pinned", pinned: true, position: 5 }),
    chapter({ id: "a", position: 0 }),
  ];
  assert.deepEqual(
    [...list].sort(compareChapters).map((c) => c.id),
    ["pinned", "a", "b"],
  );
});
