import { act, type ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Renders `element` to HTML as a server (or build) at `time`. Fakes `Date`
 * only; call `vi.useRealTimers()` after the test.
 */
export function renderAt(time: Date, element: ReactElement) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(time);
  return renderToString(element);
}

/**
 * Hydrates server `html` with `element` at a later `time`, as a browser does
 * with a prerendered page. `problems` collects every hydration mismatch React
 * reported, whether logged or recovered from by rendering on the client.
 */
export async function hydrateAt(
  time: Date,
  html: string,
  element: ReactElement,
) {
  vi.setSystemTime(time);
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);

  const problems: string[] = [];
  const logError = console.error;
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      const message = args.join(" ");
      if (/hydrat/i.test(message)) problems.push(message);
      else logError(...args);
    });

  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, element, {
        onRecoverableError: (error) => problems.push(String(error)),
      });
    });
  } finally {
    consoleError.mockRestore();
  }

  const unmount = async () => {
    await act(async () => root?.unmount());
    container.remove();
  };
  return { container, problems, unmount };
}
