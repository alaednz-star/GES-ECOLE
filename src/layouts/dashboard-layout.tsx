import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { DashboardTopbar } from "@/components/layout/dashboard-topbar";
import { OfflinePrefetch } from "@/features/desktop/offline-prefetch";
import { IS_DESKTOP } from "@/lib/desktop";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        {/* SidebarInset renders a <main>, so the content wrapper must not be a
            second one: two nested <main> landmarks break screen-reader
            navigation (the user is offered two "main" regions). */}
        <SidebarInset className="bg-background">
          <DashboardTopbar />
          {/* Desktop app: keeps what this role works with ready for offline use (ADR-010). */}
          {IS_DESKTOP && <OfflinePrefetch />}
          <div className="animate-rise mx-auto w-full max-w-7xl flex-1 space-y-8 px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
