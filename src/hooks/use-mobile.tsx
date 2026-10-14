import * as React from "react";

/**
 * Below this width the sidebar becomes a drawer instead of a fixed rail.
 *
 * 1024, not 768: the rail is a fixed 16rem, so between 768 and ~1024 it claimed
 * 256px and left too little for the content column -- every dashboard page
 * overflowed horizontally (measured: 862px on /dashboard, 1053px on
 * /dashboard/teachers, at a 820px viewport). Matching Tailwind's `lg` keeps the
 * rail only where there is room for it.
 */
const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
