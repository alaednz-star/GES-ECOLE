/**
 * Uploading a school's logo, dark logo or favicon.
 *
 * Deliberately shaped like `features/profile/avatar-upload.ts`, because the security model
 * is the same one: a public bucket whose writes are constrained by policy, a generated path
 * that never contains a user-supplied filename, and an extension taken from the MIME
 * allowlist rather than from what the file claims to be called.
 *
 * The one difference is who may write. An avatar belongs to a user and its policy scopes
 * writes to `<uid>/`; a logo belongs to the institution, so the branding policies require
 * `private.is_admin()` AND the `center/` folder. Neither is enforced here -- this file
 * makes the message accurate, Postgres makes it true.
 */

import { supabase } from "@/integrations/supabase/client";

export const BRANDING_BUCKET = "branding";
/** The deployment folder the storage policy requires. `<school_id>/` under a tenant model. */
export const BRANDING_FOLDER = "center";
/** Mirrors the bucket's own `file_size_limit`. */
export const MAX_BRANDING_BYTES = 512 * 1024;

/**
 * What the bucket accepts, mapped to the extension we store.
 *
 * SVG is absent for the same reason it is absent from `avatars`: a script container on a
 * public bucket is a stored-XSS vector. The school's vector file is what a designer works
 * from; it is not what a browser is asked to fetch.
 */
const ACCEPTED: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

export const BRANDING_ACCEPT = ".png,.webp,.ico,image/png,image/webp,image/x-icon";

export type BrandingAsset = "logo" | "logo-dark" | "favicon";
export type BrandingRejection = "type" | "size";

/** Why this file cannot be uploaded, or null. */
export function rejectBrandingFile(file: File): BrandingRejection | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED[file.type]) return "type";
  if (!["png", "webp", "ico"].includes(ext)) return "type";
  if (file.size > MAX_BRANDING_BYTES) return "size";
  return null;
}

/**
 * Uploads one branding asset and returns its public URL.
 *
 * `center/<asset>-<uuid>.<ext>`: the folder satisfies the policy, the asset name makes the
 * bucket readable by a human, and the uuid means a replacement never has to overwrite --
 * so a failed upload cannot leave the school with no logo, the same ordering rule the
 * avatar module documents.
 */
export async function uploadBrandingAsset(
  asset: BrandingAsset,
  file: File,
): Promise<{ url: string; path: string }> {
  const rejection = rejectBrandingFile(file);
  if (rejection) {
    throw new Error(rejection === "size" ? "branding-too-large" : "branding-bad-type");
  }

  const ext = ACCEPTED[file.type] ?? "png";
  const path = `${BRANDING_FOLDER}/${asset}-${globalThis.crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BRANDING_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** The storage path inside a branding URL, or null when it points somewhere else. */
export function brandingPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BRANDING_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length).split("?")[0];
  return path && path.startsWith(`${BRANDING_FOLDER}/`) ? decodeURIComponent(path) : null;
}

/**
 * Removes a replaced asset. Best effort, and only ever called AFTER the row points at the
 * new one -- so a failure leaves an orphaned object rather than a school with no logo.
 */
export async function removeBrandingAsset(path: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage.from(BRANDING_BUCKET).remove([path]);
}
