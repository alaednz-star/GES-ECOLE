import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/hooks/use-i18n";
import type { Locale } from "@/lib/i18n/config";
import type { EntityStatus, StreamRow } from "./types";

export const streamKeys = {
  all: ["streams"] as const,
  byLevel: (levelId: string) => ["streams", "level", levelId] as const,
  ofStudent: (studentId: string) => ["streams", "student", studentId] as const,
};

function toStreamRow(row: {
  id: string;
  level_id: string;
  code: string;
  name_fr: string;
  name_ar: string;
  name_en: string;
  position: number;
  status: string;
}): StreamRow {
  return {
    id: row.id,
    levelId: row.level_id,
    code: row.code,
    nameFr: row.name_fr,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    position: row.position,
    status: row.status as EntityStatus,
  };
}

const SELECT = "id, level_id, code, name_fr, name_ar, name_en, position, status";

/* ------------------------------ QUERIES ------------------------------ */

/**
 * Every active stream, in curriculum order.
 *
 * Reference data that changes about once a year, so it is fetched once and
 * cached aggressively. Prefer this plus the derived helpers below over
 * per-level queries: 14 rows is far cheaper than repeated round-trips, and it
 * lets `levelHasStreams` answer synchronously.
 */
export function useStreams() {
  return useQuery({
    queryKey: streamKeys.all,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<StreamRow[]> => {
      const { data, error } = await supabase
        .from("streams")
        .select(SELECT)
        .eq("status", "active")
        .order("position");
      if (error) throw error;
      return (data ?? []).map(toStreamRow);
    },
  });
}

/**
 * Streams offered by one level, fetched server-side.
 *
 * Use when a caller genuinely has only a level id and no access to the cached
 * full list -- otherwise `useStreamOptions().forLevel(levelId)` is cheaper.
 */
export function useStreamsByLevel(levelId: string | null | undefined) {
  return useQuery({
    queryKey: streamKeys.byLevel(levelId ?? "none"),
    enabled: !!levelId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<StreamRow[]> => {
      const { data, error } = await supabase
        .from("streams")
        .select(SELECT)
        .eq("level_id", levelId as string)
        .eq("status", "active")
        .order("position");
      if (error) throw error;
      return (data ?? []).map(toStreamRow);
    },
  });
}

export interface StudentStream {
  levelId: string | null;
  levelName: string | null;
  streamId: string | null;
  stream: StreamRow | null;
}

/**
 * A student's academic stream, resolved from their profile.
 *
 * Returns the level too, because callers that care about the stream almost
 * always need the level alongside it (a stream is meaningless without one).
 */
export function useStudentStream(studentId: string | undefined) {
  return useQuery({
    queryKey: streamKeys.ofStudent(studentId ?? "anon"),
    enabled: !!studentId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StudentStream> => {
      const { data, error } = await supabase
        .from("students")
        .select("level_id, stream_id, levels(name)")
        .eq("id", studentId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return { levelId: null, levelName: null, streamId: null, stream: null };

      if (!data.stream_id) {
        return {
          levelId: data.level_id,
          levelName: data.levels?.name ?? null,
          streamId: null,
          stream: null,
        };
      }

      const { data: stream, error: streamError } = await supabase
        .from("streams")
        .select(SELECT)
        .eq("id", data.stream_id)
        .maybeSingle();
      if (streamError) throw streamError;

      return {
        levelId: data.level_id,
        levelName: data.levels?.name ?? null,
        streamId: data.stream_id,
        stream: stream ? toStreamRow(stream) : null,
      };
    },
  });
}

/* ------------------------------ HELPERS ------------------------------ */

/** Display name for the reader's language. */
export function streamName(stream: StreamRow, locale: Locale): string {
  if (locale === "ar") return stream.nameAr;
  if (locale === "en") return stream.nameEn;
  return stream.nameFr;
}

/**
 * Whether a group is open to a given student, by stream.
 *
 * A group with no stream is open to every stream of its level -- a revision
 * class the whole year attends. Kept here so the rule lives in one place rather
 * than being re-expressed at each call site.
 */
export function groupMatchesStream(
  groupStreamId: string | null,
  studentStreamId: string | null,
): boolean {
  return groupStreamId === null || groupStreamId === studentStreamId;
}

/**
 * Stream helpers bound to the current locale, derived from a single cached
 * fetch.
 *
 * `levelHasStreams` is the one source of truth for "does this level require a
 * stream?". Primary and middle levels simply have no stream rows, so the answer
 * comes from data rather than a hardcoded stage check.
 */
export function useStreamOptions() {
  const { locale } = useI18n();
  const { data: streams = [], isLoading, error, refetch, isFetching } = useStreams();

  return useMemo(() => {
    const byLevel = new Map<string, StreamRow[]>();
    const byId = new Map<string, StreamRow>();
    for (const s of streams) {
      const list = byLevel.get(s.levelId) ?? [];
      list.push(s);
      byLevel.set(s.levelId, list);
      byId.set(s.id, s);
    }

    return {
      streams,
      isLoading,
      error,
      refetch,
      isFetching,
      /** Streams offered by a level, in curriculum order. */
      forLevel: (levelId: string | null | undefined): StreamRow[] =>
        levelId ? (byLevel.get(levelId) ?? []) : [],
      /** True when the level offers streams and one must be chosen. */
      levelHasStreams: (levelId: string | null | undefined): boolean =>
        !!levelId && (byLevel.get(levelId)?.length ?? 0) > 0,
      /** The full row for a stream id, or null. */
      byId: (streamId: string | null | undefined): StreamRow | null =>
        streamId ? (byId.get(streamId) ?? null) : null,
      /** Localised name for a stream id, or null when unset/unknown. */
      nameOf: (streamId: string | null | undefined): string | null => {
        if (!streamId) return null;
        const found = byId.get(streamId);
        return found ? streamName(found, locale) : null;
      },
    };
  }, [streams, isLoading, error, refetch, isFetching, locale]);
}
