import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { NotificationKind, NotificationRow } from "./types";

export const notificationKeys = {
  all: (userId: string) => ["notifications", userId] as const,
};

/**
 * Notifications store a `kind` plus a jsonb `params` bag rather than rendered
 * prose, so the same row renders correctly in French, Arabic or English
 * depending on who is reading it. `notification.<kind>` is the template key.
 */
export function useNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: notificationKeys.all(userId ?? "anon"),
    enabled: !!userId,
    // The inbox should feel live without hammering the API.
    refetchInterval: 60_000,
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, kind, params, read_at, created_at")
        .eq("user_id", userId as string)
        // A scheduled publication creates its notice when the teacher decides and
        // marks it deliverable when the material actually appears. The read POLICY
        // already hides pending rows from their owner; this repeats it because an
        // admin bypasses that policy and would otherwise see their own future
        // notices in the bell.
        .lte("deliver_at", new Date().toISOString())
        .order("deliver_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((n) => ({
        id: n.id,
        kind: n.kind as NotificationKind,
        params: (n.params ?? {}) as Record<string, string>,
        readAt: n.read_at,
        createdAt: n.created_at,
      }));
    },
  });
}

export function useMarkNotificationRead(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all(userId ?? "anon") }),
  });
}

export function useMarkAllNotificationsRead(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all(userId ?? "anon") }),
  });
}
