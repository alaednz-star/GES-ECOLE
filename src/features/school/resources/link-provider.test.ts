/**
 * `linkFaceOf` is pure URL parsing, which is exactly the kind of code that fails on
 * the input nobody thought of. These run under `node:test` with Node's native TS
 * type-stripping, like the session tests -- no new dependency.
 *
 *   node --test src/features/school/resources/link-provider.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { linkFaceOf, providerOf, thumbnailFor } from "./link-provider.ts";

test("a YouTube watch URL becomes an embeddable no-cookie URL", () => {
  const face = linkFaceOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(face.provider, "youtube");
  assert.equal(face.embedUrl, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
});

test("the short form, shorts, live and /embed all resolve to the same id", () => {
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
  ]) {
    assert.equal(
      linkFaceOf(url).embedUrl,
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      url,
    );
  }
});

test("extra query parameters do not break detection", () => {
  const face = linkFaceOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLabc");
  assert.equal(face.embedUrl, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
});

test("a YouTube URL with no usable id is YouTube but not embeddable", () => {
  // A channel or a search page: the provider is right, there is nothing to frame.
  const face = linkFaceOf("https://www.youtube.com/@someteacher");
  assert.equal(face.provider, "youtube");
  assert.equal(face.embedUrl, null);
});

test("detection is by HOST, so a lookalike path is not mistaken for YouTube", () => {
  // The whole reason not to substring-match the URL: this would otherwise be framed
  // against an attacker-controlled origin.
  const face = linkFaceOf("https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(face.provider, "other");
  assert.equal(face.embedUrl, null);
});

test("a Drive file link becomes its /preview form", () => {
  const face = linkFaceOf("https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing");
  assert.equal(face.provider, "drive");
  assert.equal(face.embedUrl, "https://drive.google.com/file/d/1AbCdEfGhIjK/preview");
});

test("Docs, Sheets and Slides each get their own /preview", () => {
  assert.equal(
    linkFaceOf("https://docs.google.com/document/d/1AbC/edit").embedUrl,
    "https://docs.google.com/document/d/1AbC/preview",
  );
  assert.equal(
    linkFaceOf("https://docs.google.com/spreadsheets/d/1AbC/edit#gid=0").embedUrl,
    "https://docs.google.com/spreadsheets/d/1AbC/preview",
  );
  assert.equal(
    linkFaceOf("https://docs.google.com/presentation/d/1AbC/edit").embedUrl,
    "https://docs.google.com/presentation/d/1AbC/preview",
  );
});

test("Dropbox is served raw rather than through its viewer page", () => {
  const face = linkFaceOf("https://www.dropbox.com/s/abc123/TD3.pdf?dl=0");
  assert.equal(face.provider, "dropbox");
  assert.ok(face.embedUrl?.includes("raw=1"), face.embedUrl ?? "null");
  assert.ok(!face.embedUrl?.includes("dl=0"), "the dl parameter must not survive");
});

test("OneDrive is recognised but honestly reported as unframeable", () => {
  const face = linkFaceOf("https://onedrive.live.com/?id=ABC");
  assert.equal(face.provider, "onedrive");
  assert.equal(face.embedUrl, null);
});

test("Vimeo resolves to its player", () => {
  assert.equal(
    linkFaceOf("https://vimeo.com/123456789").embedUrl,
    "https://player.vimeo.com/video/123456789",
  );
});

test("http is never framed, even from a provider that would otherwise embed", () => {
  // An older row could hold http; framing it would be mixed content on an https page.
  const face = linkFaceOf("http://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(face.provider, "other");
  assert.equal(face.embedUrl, null);
});

test("malformed, empty and missing input never throw", () => {
  for (const bad of ["", "   ", "not a url", "javascript:alert(1)", null, undefined]) {
    const face = linkFaceOf(bad);
    assert.equal(face.provider, "other", JSON.stringify(bad));
    assert.equal(face.embedUrl, null);
  }
});

test("providerOf is what gets stored, and matches the face", () => {
  assert.equal(providerOf("https://youtu.be/dQw4w9WgXcQ"), "youtube");
  assert.equal(providerOf("https://example.test/notes.pdf"), "other");
  assert.equal(providerOf(null), "other");
});

test("a YouTube thumbnail is derived from the same id as the embed", () => {
  const face = linkFaceOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(face.thumbnailUrl, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
});

test("every YouTube URL shape yields the same thumbnail", () => {
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ]) {
    assert.equal(
      linkFaceOf(url).thumbnailUrl,
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      url,
    );
  }
});

test("hqdefault, not maxresdefault -- it exists for every video", () => {
  // maxresdefault 404s for anything never published in HD, which would show a broken
  // image for exactly the older material a school is most likely to link.
  const t = linkFaceOf("https://youtu.be/dQw4w9WgXcQ").thumbnailUrl ?? "";
  assert.ok(t.endsWith("/hqdefault.jpg"), t);
  assert.ok(!t.includes("maxresdefault"), t);
});

test("a YouTube URL with no video id has no thumbnail", () => {
  // A channel page is still YouTube, but there is no still to show for it.
  const face = linkFaceOf("https://www.youtube.com/@someteacher");
  assert.equal(face.provider, "youtube");
  assert.equal(face.thumbnailUrl, null);
});

test("providers whose thumbnail needs a network call return null, not a guess", () => {
  const cases = [
    ["https://vimeo.com/123456789", "vimeo"],
    ["https://drive.google.com/file/d/1AbCdEfGhIj/view", "drive"],
    ["https://docs.google.com/document/d/1AbC/edit", "drive"],
    ["https://www.dropbox.com/s/abc123/TD3.pdf?dl=0", "dropbox"],
    ["https://onedrive.live.com/?id=ABC", "onedrive"],
    ["https://example.test/notes.pdf", "other"],
  ];
  for (const [url, provider] of cases) {
    const face = linkFaceOf(url);
    assert.equal(face.provider, provider, url);
    assert.equal(face.thumbnailUrl, null, url);
  }
});

test("http is refused a thumbnail, as it is refused an embed", () => {
  // Mixed content: an https page cannot load an http still.
  const face = linkFaceOf("http://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(face.thumbnailUrl, null);
});

test("malformed input never throws and never invents a thumbnail", () => {
  for (const bad of ["", "   ", "not a url", "javascript:alert(1)", null, undefined]) {
    assert.equal(linkFaceOf(bad).thumbnailUrl, null, JSON.stringify(bad));
  }
});

test("thumbnailFor is what gets stored, and matches the face", () => {
  assert.equal(
    thumbnailFor("https://youtu.be/dQw4w9WgXcQ"),
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
  assert.equal(thumbnailFor("https://vimeo.com/123456789"), null);
  assert.equal(thumbnailFor(null), null);
});
