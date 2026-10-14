/**
 * What an external link actually points at. PURE.
 *
 * This exists because "a link" is not one thing. A YouTube watch URL cannot be framed
 * at all -- YouTube sends `X-Frame-Options: SAMEORIGIN`, so the preview showed a
 * refused-to-connect frame -- while its `/embed/` form is designed for exactly that. A
 * Drive file has a `/preview` form. Dropbox needs a query parameter. Treating them
 * identically meant the most common link a teacher shares was the one that did not
 * work.
 *
 * Detection is by hostname, never by scanning the whole URL for a substring: a path
 * containing the word "youtube" on some other host would otherwise be misread, and the
 * consequence is an embed pointed at the wrong origin.
 */

export type LinkProvider = "youtube" | "vimeo" | "drive" | "dropbox" | "onedrive" | "other";

export interface LinkFace {
  provider: LinkProvider;
  /** i18n key for the provider name. */
  labelKey: string;
  /**
   * A URL that can safely go in an iframe, or null when the provider refuses framing.
   * Null is a real answer, not a failure: the UI offers "open externally" instead of
   * rendering a frame the student will only see an error in.
   */
  embedUrl: string | null;
  /**
   * A still image for the link, or null when one cannot be known without asking the
   * provider.
   *
   * Only YouTube is derivable: its thumbnail lives at a fixed path built from the video
   * id, so the value is a pure function of the URL. Vimeo, Drive, Dropbox and OneDrive
   * all require an authenticated or rate-limited API call to discover an image, and this
   * module is pure by design -- it parses URLs and never makes a request. Null here means
   * "not knowable from the URL alone", which the caller renders as the provider icon it
   * already shows today.
   */
  thumbnailUrl: string | null;
}

/** Hosts that mean YouTube, including the short form and the no-cookie mirror. */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
]);

/** The 11-character id YouTube uses, wherever it happens to sit in the URL. */
function youtubeId(u: URL): string | null {
  if (u.hostname === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }
  const v = u.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;
  // /embed/<id>, /shorts/<id>, /live/<id>
  const m = /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname);
  return m?.[1] ?? null;
}

function driveEmbed(u: URL): string | null {
  // /file/d/<id>/view -> /file/d/<id>/preview, which Drive serves for framing.
  const m = /^\/file\/d\/([\w-]+)/.exec(u.pathname);
  if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  // Docs, Sheets and Slides all frame from their /preview form too.
  const d = /^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/.exec(u.pathname);
  if (d) return `https://docs.google.com/${d[1]}/d/${d[2]}/preview`;
  return null;
}

/**
 * Reads a URL and says what it is and how (or whether) to frame it.
 *
 * Never throws: a malformed URL is `other` with no embed, because a teacher pasting
 * something odd should get a link that still opens rather than a broken page.
 */
export function linkFaceOf(rawUrl: string | null | undefined): LinkFace {
  const fallback: LinkFace = {
    provider: "other",
    labelKey: "resources.link.other",
    embedUrl: null,
    thumbnailUrl: null,
  };
  if (!rawUrl) return fallback;

  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return fallback;
  }
  // Only https is ever framed. The upload dialog already refuses anything else, but
  // an older row could hold http, and framing that would be mixed content.
  if (u.protocol !== "https:") return fallback;

  const host = u.hostname.toLowerCase();

  if (YOUTUBE_HOSTS.has(host)) {
    const id = youtubeId(u);
    return {
      provider: "youtube",
      labelKey: "resources.link.youtube",
      // `youtube-nocookie.com` is YouTube's own privacy-enhanced host: it does not set
      // tracking cookies until playback. For a page full of school children that is
      // the right default, and it costs nothing.
      embedUrl: id ? `https://www.youtube-nocookie.com/embed/${id}` : null,
      /*
        `i.ytimg.com` is YouTube's image host and the path is stable, so this is derived
        rather than fetched. `hqdefault` is chosen over `maxresdefault` because it exists
        for every video -- `maxresdefault` 404s on anything never published in HD, which
        would show a broken image for exactly the older material a school is most likely
        to link.
      */
      thumbnailUrl: id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null,
    };
  }

  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const m = /(\d{6,})/.exec(u.pathname);
    return {
      provider: "vimeo",
      labelKey: "resources.link.vimeo",
      embedUrl: m ? `https://player.vimeo.com/video/${m[1]}` : null,
      // Vimeo publishes thumbnails only through its oEmbed API, which is a network call.
      thumbnailUrl: null,
    };
  }

  if (host === "drive.google.com" || host === "docs.google.com") {
    return {
      provider: "drive",
      labelKey: "resources.link.drive",
      embedUrl: driveEmbed(u),
      // Drive thumbnails need an authenticated request; a signed-out student would get a
      // broken image, so the provider icon is the honest fallback.
      thumbnailUrl: null,
    };
  }

  if (host.endsWith("dropbox.com")) {
    // `raw=1` serves the file itself rather than Dropbox's own viewer page, which
    // refuses framing.
    const embed = new URL(u.toString());
    embed.searchParams.set("raw", "1");
    embed.searchParams.delete("dl");
    return {
      provider: "dropbox",
      labelKey: "resources.link.dropbox",
      embedUrl: embed.toString(),
      thumbnailUrl: null,
    };
  }

  if (
    host.endsWith("onedrive.live.com") ||
    host.endsWith("1drv.ms") ||
    host.endsWith("sharepoint.com")
  ) {
    // OneDrive's share links need a per-tenant embed call to frame reliably; offering
    // "open externally" is honest rather than showing an error frame.
    return {
      provider: "onedrive",
      labelKey: "resources.link.onedrive",
      embedUrl: null,
      thumbnailUrl: null,
    };
  }

  return fallback;
}

/**
 * The value stored in `resources.link_thumbnail_url`. Derived, never user-entered.
 *
 * Stored rather than recomputed on read for the same reason `link_provider` is: a row
 * should describe itself. It also means that the day a provider becomes derivable,
 * existing rows keep what was true when they were saved rather than changing silently
 * underneath the people who saved them.
 */
export function thumbnailFor(rawUrl: string | null | undefined): string | null {
  return linkFaceOf(rawUrl).thumbnailUrl;
}

/** The value stored in `resources.link_provider`. Derived, never user-entered. */
export function providerOf(rawUrl: string | null | undefined): LinkProvider {
  return linkFaceOf(rawUrl).provider;
}
