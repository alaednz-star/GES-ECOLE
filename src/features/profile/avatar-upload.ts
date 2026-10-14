/**
 * Uploading a profile photo.
 *
 * The profile page used to accept a pasted `https://` URL and validate it with a
 * regex, because there was no bucket to upload into. `20260812120000` adds one:
 * public to read, writable only inside `<user_id>/`.
 *
 * THE ORDER MATTERS. Upload the new object, point the profile at it, and only then
 * delete the old one. Deleting first would mean a failed upload leaves the user with no
 * photo at all -- worse than the photo they had. If the delete at the end fails, the
 * result is one orphaned 40 kB object, which is the cheap end of the trade.
 *
 * Client validation here is for the message, not for safety. The bucket carries its own
 * MIME allowlist and size limit, and the write policy carries the path rule, so a
 * crafted request gets refused by Postgres rather than by this file.
 */

import { supabase } from "@/integrations/supabase/client";

export const AVATAR_BUCKET = "avatars";
/** Mirrors the bucket's own `file_size_limit`. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * What the bucket accepts, mapped to the extension we will store.
 *
 * SVG is absent deliberately: it is a script container, and this bucket is public.
 */
const ACCEPTED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const AVATAR_ACCEPT = Object.keys(ACCEPTED).join(",");

export type AvatarRejection = "type" | "size";

/** Why this file cannot be uploaded, or null. */
export function rejectAvatar(file: File): AvatarRejection | null {
  // The MIME type AND the extension have to agree with the allowlist. A `.png` holding
  // something else is refused by the bucket anyway; checking both here just makes the
  // message accurate.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowedExt = ACCEPTED[file.type];
  if (!allowedExt) return "type";
  if (!["jpg", "jpeg", "png", "webp"].includes(ext)) return "type";
  if (file.size > MAX_AVATAR_BYTES) return "size";
  return null;
}

/**
 * Uploads a photo for one user and returns its public URL.
 *
 * The path is generated -- `<user_id>/<uuid>.<ext>` -- and never derived from the
 * file's own name. A user-supplied name in a storage path is how you end up with
 * `../` traversal, a name that collides with someone else's, or a
 * `Content-Disposition` that lies. The extension comes from the MIME allowlist rather
 * than from the filename for the same reason.
 *
 * `upsert: false` because the uuid is fresh: a collision would mean something is wrong
 * rather than something needs replacing.
 */
export async function uploadAvatar(
  userId: string,
  file: File,
): Promise<{ url: string; path: string }> {
  const rejection = rejectAvatar(file);
  if (rejection) throw new Error(rejection === "size" ? "avatar-too-large" : "avatar-bad-type");

  const ext = ACCEPTED[file.type] ?? "jpg";
  const path = `${userId}/${globalThis.crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/**
 * The storage path inside an avatar URL, or null if it points somewhere else.
 *
 * Needed to clean up a replaced photo. Returns null for the URLs the old
 * paste-a-link profile page allowed, so an externally hosted photo is never treated as
 * ours to delete.
 */
export function avatarPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length).split("?")[0];
  return path && path.includes("/") ? decodeURIComponent(path) : null;
}

/**
 * Removes a previously stored photo. Best effort by design.
 *
 * Called only AFTER the profile points at the new object, so a failure here leaves an
 * orphan rather than a profile with no photo. Storage RLS refuses anything outside the
 * caller's own folder, so this cannot be turned into a way to delete someone else's.
 */
export async function removeAvatar(path: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage.from(AVATAR_BUCKET).remove([path]);
}
