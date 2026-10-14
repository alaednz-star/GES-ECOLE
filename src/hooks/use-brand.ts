import { useContext } from "react";
import { BrandContext } from "@/features/branding/brand-provider";
import { PRODUCT_BRAND, resolveBrand, type Brand } from "@/lib/brand";

/**
 * This deployment's branding.
 *
 * Unlike `useAuth`, this does NOT throw when the provider is absent. A component rendered
 * outside `BrandProvider` -- an error boundary above it, a test mounting one card in
 * isolation -- should draw itself in platform colours, not crash. Branding failing loudly
 * is the one failure mode this feature must not have.
 */
export function useBrand(): { brand: Brand; isResolved: boolean } {
  const ctx = useContext(BrandContext);
  if (!ctx) return { brand: resolveBrand(null), isResolved: false };
  return ctx;
}

export { PRODUCT_BRAND };
