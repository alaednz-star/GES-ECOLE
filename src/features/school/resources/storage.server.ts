/**
 * Privileged storage operations for course resources. SERVER ONLY.
 *
 * WHY THIS FILE EXISTS
 *
 * `allow_download = false` used to be enforced only by hiding a button. Anyone who
 * could read the row could still mint a download URL from the browser, because
 * Supabase Storage cannot distinguish "preview this" from "save this" at the
 * policy level -- both need SELECT on the same object.
 *
 * So the decision moves to the server: this module holds the service role, asks
 * the database whether the CALLER may view or download, and only then mints a
 * signed URL. The React UI hiding a button is now a convenience on top of the
 * rule, not the rule itself.
 *
 * The authority is `can_view_resource()` / `can_download_resource()` in
 * `20260811100000_resources_phase1_foundation.sql`, evaluated as the caller via a
 * user-scoped client -- never as the service role, or the check would authorise
 * everything.
 *
 * Never import this from a component. `storage.functions.ts` is the boundary, and
 * it imports this lazily so the service-role client stays out of the browser
 * bundle -- the same discipline `provisioning.functions.ts` documents.
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

const BUCKET = "course-resources";
/** One hour: long enough to watch a video, short enough that a copied link dies. */
const TTL_SECONDS = 3600;
/** 250 MB. Mirrors the bucket's own `file_size_limit`. */
export const MAX_FILE_BYTES = 262_144_000;

export class StorageAuthError extends Error {
  constructor(
    message: string,
    readonly kind: "unauthenticated" | "forbidden" | "not-found" | "too-large" | "quota",
  ) {
    super(message);
    this.name = "StorageAuthError";
  }
}

/**
 * A Supabase client acting AS THE CALLER, so RLS and the `can_*` helpers see the
 * real user. The service-role client is used only to mint the URL afterwards.
 */
function asCaller(accessToken: string) {
  const url = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new StorageAuthError("Storage is not configured.", "forbidden");
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireCaller(accessToken: string | undefined) {
  if (!accessToken) throw new StorageAuthError("Not signed in.", "unauthenticated");
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) throw new StorageAuthError("Not signed in.", "unauthenticated");
  return data.user;
}

/**
 * A signed URL for one resource.
 *
 * `intent` decides which rule applies. `download` additionally requires
 * `allow_download` for a student, and only then is Content-Disposition set --
 * so a student denied download never receives an attachment URL at all.
 */
export async function signResource(
  accessToken: string | undefined,
  resourceId: string,
  intent: "view" | "download",
): Promise<{ url: string; fileName: string | null }> {
  await requireCaller(accessToken);
  const caller = asCaller(accessToken as string);

  // The database decides, evaluated as the caller.
  const rpc = intent === "download" ? "can_download_resource" : "can_view_resource";
  const { data: allowed, error: rpcError } = await caller.rpc(rpc, { _resource_id: resourceId });
  if (rpcError) throw new StorageAuthError(rpcError.message, "forbidden");
  if (allowed !== true) {
    throw new StorageAuthError(
      intent === "download"
        ? "Le téléchargement n'est pas autorisé pour cette ressource."
        : "Vous n'avez pas accès à cette ressource.",
      "forbidden",
    );
  }

  // Read the path with the SERVICE role: the caller's own read is already
  // authorised above, and going through the admin client keeps this working for a
  // staff member whose row-level read is scoped differently.
  const admin = supabaseAdmin;
  const { data: row, error: rowError } = await admin
    .from("resources")
    .select("storage_path, file_name, kind, url")
    .eq("id", resourceId)
    .maybeSingle();
  if (rowError) throw new StorageAuthError(rowError.message, "not-found");
  if (!row) throw new StorageAuthError("Ressource introuvable.", "not-found");

  // A link needs no signing; returning it here keeps one call site for both kinds.
  if (row.kind === "link") {
    if (!row.url) throw new StorageAuthError("Ressource introuvable.", "not-found");
    return { url: row.url, fileName: null };
  }
  if (!row.storage_path) throw new StorageAuthError("Fichier introuvable.", "not-found");

  const { data: signed, error: signError } = await admin.storage.from(BUCKET).createSignedUrl(
    row.storage_path,
    TTL_SECONDS,
    // Attachment ONLY for an authorised download.
    intent === "download" ? { download: row.file_name ?? true } : {},
  );
  if (signError || !signed) {
    throw new StorageAuthError(signError?.message ?? "Signature impossible.", "not-found");
  }
  return { url: signed.signedUrl, fileName: row.file_name ?? null };
}

/**
 * Checks a pending upload against the per-file limit and the centre quota.
 *
 * Both are also enforced by the bucket and by the client, for different reasons:
 * the bucket is the last line and cannot be bypassed, the client fails fast with a
 * readable message, and this exists so the quota -- which the bucket knows nothing
 * about -- is decided somewhere the browser cannot edit.
 */
export async function assertUploadAllowed(
  accessToken: string | undefined,
  groupId: string,
  sizeBytes: number,
  /**
   * The largest single file in this batch. Omitted for one file, where it equals
   * `sizeBytes`.
   *
   * The two limits are different questions and were being asked with one number: the
   * centre quota is about the TOTAL about to be added, the 250 MB rule is about ONE
   * file. Passing a batch total to both would reject two perfectly legal 200 MB videos
   * as though they were a single 400 MB one.
   */
  largestFileBytes?: number,
): Promise<{ usedBytes: number; quotaBytes: number }> {
  await requireCaller(accessToken);
  const caller = asCaller(accessToken as string);

  const largest = largestFileBytes ?? sizeBytes;
  if (
    !Number.isFinite(sizeBytes) ||
    sizeBytes < 0 ||
    !Number.isFinite(largest) ||
    largest < 0 ||
    largest > sizeBytes
  ) {
    throw new StorageAuthError("Taille de fichier invalide.", "too-large");
  }
  if (largest > MAX_FILE_BYTES) {
    throw new StorageAuthError(
      "Ce fichier dépasse 250 Mo. Compressez-le ou partagez un lien Drive.",
      "too-large",
    );
  }

  // Only a manager of the group may upload into it.
  const { data: canManage, error: manageError } = await caller.rpc("can_manage_group", {
    _group_id: groupId,
  });
  if (manageError) throw new StorageAuthError(manageError.message, "forbidden");
  if (canManage !== true) {
    throw new StorageAuthError("Vous ne gérez pas ce groupe.", "forbidden");
  }

  const admin = supabaseAdmin;
  const [{ data: used }, { data: quota }] = await Promise.all([
    admin.rpc("center_storage_bytes"),
    admin.rpc("center_storage_quota_bytes"),
  ]);
  const usedBytes = Number(used ?? 0);
  const quotaBytes = Number(quota ?? 0);

  if (usedBytes + sizeBytes > quotaBytes) {
    const freeMb = Math.max(0, Math.floor((quotaBytes - usedBytes) / 1_048_576));
    throw new StorageAuthError(
      `Espace de stockage insuffisant : il reste ${freeMb} Mo sur 5 Go.`,
      "quota",
    );
  }
  return { usedBytes, quotaBytes };
}
