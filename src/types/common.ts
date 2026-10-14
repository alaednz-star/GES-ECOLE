import type { LucideIcon } from "lucide-react";
import type { Role } from "./auth";

export interface NavItem {
  /** Translation key resolved through the i18n dictionary. */
  labelKey: string;
  to: string;
  icon: LucideIcon;
  /** Roles allowed to see this entry. Empty means everyone. */
  roles?: Role[];
  exact?: boolean;
  badge?: string;
  /** Reserved for features that are scaffolded but not implemented yet. */
  comingSoon?: boolean;
}

export interface NavSection {
  titleKey: string;
  items: NavItem[];
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type AsyncState = "idle" | "loading" | "success" | "error";
