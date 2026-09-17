import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Whether a render may use browser-only values such as the current time or
 * the viewer's time zone.
 *
 * False on the server and while hydrating, so the first client render matches
 * the HTML, which may have been prerendered at build time. True for the render
 * that follows hydration and for components first mounted after it.
 */
export default function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
