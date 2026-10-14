/**
 * Client-side error reporting.
 *
 * Forwards errors caught by React error boundaries to whatever telemetry hook
 * the host page provides. Both hooks are optional: when nothing installs them
 * this module is a no-op, so the app never depends on an external reporter
 * being present.
 *
 * The `__lovableEvents` / `__lovableReportRuntimeError` names are the runtime
 * contract of the preview host that injects them -- they are read, never
 * created, by this project. Renaming them here would simply stop errors being
 * reported; they are deliberately left as-is for that reason.
 */

type ReportOptions = {
  mechanism?: "manual" | "onerror" | "unhandledrejection" | "react_error_boundary";
  handled?: boolean;
  severity?: "error" | "warning" | "info";
};

type TelemetryHost = {
  captureException?: (
    error: unknown,
    context?: Record<string, unknown>,
    options?: ReportOptions,
  ) => void;
};

declare global {
  interface Window {
    __lovableEvents?: TelemetryHost;
    __lovableReportRuntimeError?: (payload: {
      message: string;
      stack?: string;
      filename?: string;
    }) => void;
  }
}

/** Reports a boundary-caught error, if a telemetry host is installed. */
export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  window.__lovableEvents?.captureException?.(
    error,
    {
      source: "react_error_boundary",
      route: window.location.pathname,
      ...context,
    },
    {
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    },
  );

  // Production React does not rethrow boundary-caught errors to window.onerror,
  // so a host listening only there would never see them. Forward explicitly.
  //
  // Loaders and server functions commonly throw a raw Response; String(it)
  // yields the opaque "[object Response]", so pull out status and URL instead.
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  window.__lovableReportRuntimeError?.({
    message,
    ...(stack !== undefined && { stack }),
    filename: window.location.pathname,
  });
}
