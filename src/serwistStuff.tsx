import { setupLoomPwaLifecycle } from "@gadicc/loom/next/pwa";
import asyncConfirm from "./asyncConfirm";

/** Registers the shared lifecycle with Magickly's update dialog and poll rate. */
export default function serwistStuff() {
  return setupLoomPwaLifecycle({
    updateMode: "prompt",
    updateCheckIntervalMs: 60_000,
    confirmUpdate: () =>
      asyncConfirm(
        "A newer version of this web app is available, reload to update?",
      ),
    onError: (error) =>
      console.warn("[PWA] Service worker lifecycle failed", error),
    logger: false,
  });
}
