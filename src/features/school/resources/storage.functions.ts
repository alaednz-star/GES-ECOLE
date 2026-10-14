/**
 * Server-function boundary for course-resource storage.
 *
 * `storage.server.ts` is imported INSIDE each handler, never at module scope:
 * this file is reachable from the client graph, so a top-level import would pull
 * the service-role client into the browser bundle. Same discipline as
 * `provisioning.functions.ts`.
 *
 * Validation runs here as well as in the UI, because a server function is a public
 * HTTP endpoint and cannot trust its input.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const signSchema = z.object({
  accessToken: z.string().min(1),
  resourceId: z.string().uuid(),
  intent: z.enum(["view", "download"]),
});

const uploadSchema = z.object({
  accessToken: z.string().min(1),
  groupId: z.string().uuid(),
  /** Total bytes this batch will add, checked against the centre quota. */
  sizeBytes: z.number().int().min(0),
  /** Largest single file, checked against the 250 MB per-file rule. */
  largestFileBytes: z.number().int().min(0).optional(),
});

/** A signed URL, issued only if the database says this caller may have one. */
export const signResourceUrlFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => signSchema.parse(input))
  .handler(async ({ data }) => {
    const { signResource } = await import("./storage.server");
    return signResource(data.accessToken, data.resourceId, data.intent);
  });

/** Per-file limit and centre quota, decided server-side. */
export const assertUploadAllowedFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => uploadSchema.parse(input))
  .handler(async ({ data }) => {
    const { assertUploadAllowed } = await import("./storage.server");
    return assertUploadAllowed(
      data.accessToken,
      data.groupId,
      data.sizeBytes,
      data.largestFileBytes,
    );
  });
