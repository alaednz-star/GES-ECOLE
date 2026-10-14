import { Link, useRouterState } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Brand } from "@/components/common/brand";
import { useBrand } from "@/hooks/use-brand";
import { dashboardNavigation, filterNavigationByRole } from "@/config/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { t } = useI18n();
  const { brand } = useBrand();
  const { user } = useAuth();
  const pathname = useRouterState({ select: (router) => router.location.pathname });

  const sections = filterNavigationByRole(dashboardNavigation, user?.role ?? null);

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <Sidebar collapsible="icon" className="border-border">
      <SidebarHeader className="px-3 py-4">
        <Link to="/dashboard" className="focus-ring rounded-xl">
          <Brand showWordmark={!collapsed} size="sm" />
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-1">
        {sections.map((section) => (
          <SidebarGroup key={section.titleKey} className="py-1">
            {!collapsed && (
              <SidebarGroupLabel className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80">
                {t(section.titleKey)}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const label = t(item.labelKey);
                  const active = !item.comingSoon && isActive(item.to, item.exact);

                  if (item.comingSoon) {
                    return (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton
                          tooltip={`${label} · ${t("state.comingSoon")}`}
                          aria-disabled
                          className="cursor-not-allowed opacity-55 hover:bg-transparent"
                        >
                          <item.icon className="size-4 shrink-0" aria-hidden />
                          {!collapsed && (
                            <>
                              <span className="flex-1 truncate">{label}</span>
                              <Badge
                                variant="secondary"
                                className="rounded-full px-1.5 text-[0.6rem] font-medium"
                              >
                                {t("state.comingSoon")}
                              </Badge>
                            </>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }

                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={active} tooltip={label}>
                        <Link
                          to={item.to}
                          className={cn(
                            "relative flex items-center gap-2.5",
                            active && "font-medium",
                          )}
                        >
                          {active && !collapsed && (
                            <span
                              className="absolute inset-y-1.5 w-0.5 rounded-full bg-primary ltr:-left-2 rtl:-right-2"
                              aria-hidden
                            />
                          )}
                          <item.icon
                            className={cn("size-4 shrink-0", active && "text-primary")}
                            aria-hidden
                          />
                          {!collapsed && <span className="flex-1 truncate">{label}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-3 pb-4">
        {!collapsed && (
          <p
            dir="auto"
            className="rounded-xl bg-muted px-3 py-2 text-[0.7rem] leading-relaxed text-muted-foreground"
          >
            {/*
              The school's own line when it has one, the platform's otherwise. This is the
              one slot in the dashboard that already held a tagline, so branding lands in
              it rather than adding a second place for the same sentence.
            */}
            {brand.tagline ?? t("brand.tagline")}
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
