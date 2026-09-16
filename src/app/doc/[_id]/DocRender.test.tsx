// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DocContext from "@/doc/context";
import type { DocNode } from "@/schemas";
import DocRender, { DocView } from "./DocRender";

// Observe the real DocRender context without exercising JRT's unrelated hook
// machinery. Inputs, their debounce, and Next's useSearchParams remain real.
vi.mock("@/doc/blocks", () => ({
  Render: function ContextValues() {
    const context = React.useContext(DocContext);
    return (
      <output data-testid="ritual-variables">
        {JSON.stringify(
          Object.fromEntries(
            Object.entries(context.vars).map(([name, variable]) => [
              name,
              (variable as { value: string }).value,
            ]),
          ),
        )}
      </output>
    );
  },
}));
const doc: DocNode = {
  type: "root",
  children: [
    {
      type: "declareVar",
      name: "myRole",
      label: "My Role",
      default: "member",
      varType: "select",
      children: [
        { type: "option", value: "member", label: "Member" },
        { type: "option", value: "hierophant", label: "Hierophant" },
      ],
    },
    {
      type: "declareVar",
      name: "motto",
      label: "Motto",
      default: "Default motto",
      varType: "text",
    },
  ],
};
const router = {
  bfcacheId: "ritual-test",
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  hmrRefresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const nativeReplace = window.history.replaceState.bind(window.history);
let replaceState: ReturnType<typeof vi.spyOn>;
function HistoryHarness() {
  // Model Next's documented native-history/provider boundary. The actual
  // production bridge and offline worker behavior are checked in the browser.
  const href = React.useSyncExternalStore(
    subscribe,
    () => window.location.href,
  );
  return (
    <AppRouterContext.Provider value={router}>
      <SearchParamsContext.Provider value={new URL(href).searchParams}>
        <DocRender doc={doc} />
      </SearchParamsContext.Provider>
    </AppRouterContext.Provider>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  listeners.clear();
  nativeReplace(null, "", "/doc/neophyte");
  replaceState = vi
    .spyOn(window.history, "replaceState")
    .mockImplementation((state, unused, url) => {
      nativeReplace(state, unused, url);
      for (const listener of listeners) listener();
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Offline"))),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(path: string) {
  nativeReplace(null, "", path);
  render(<HistoryHarness />);
}
function chooseHierophant() {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "My Role" }));
  fireEvent.click(screen.getByRole("option", { name: "Hierophant" }));
}
function variables() {
  return JSON.parse(screen.getByTestId("ritual-variables").textContent || "{}");
}
async function advance(milliseconds = 1000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe("prerendered rituals", () => {
  it("draw every default without a router or query", () => {
    const html = renderToString(<DocView doc={doc} searchParams={null} />);
    expect(html).toContain(
      "{&quot;myRole&quot;:&quot;member&quot;,&quot;motto&quot;:&quot;Default motto&quot;}",
    );
  });
});

describe("ritual variables use local URL state", () => {
  it("initializes inputs and render context from the URL", () => {
    mount("/doc/neophyte?myRole=hierophant&motto=Existing+value#Opening");
    expect(screen.getByRole("combobox", { name: "My Role" }).textContent).toBe(
      "Hierophant",
    );
    expect(
      (screen.getByRole("textbox", { name: "Motto" }) as HTMLInputElement)
        .value,
    ).toBe("Existing value");
    expect(variables()).toEqual({
      myRole: "hierophant",
      motto: "Existing value",
    });
    expect(replaceState).not.toHaveBeenCalled();
  });
  it("changes role without navigation, retaining path, hash and other parameters", async () => {
    mount("/doc/neophyte?locale=en&tag=one&tag=two#Opening");
    const historyLength = window.history.length;
    chooseHierophant();
    expect(variables().myRole).toBe("member");
    await advance();
    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/doc/neophyte");
    expect(url.hash).toBe("#Opening");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.getAll("tag")).toEqual(["one", "two"]);
    expect(url.searchParams.get("myRole")).toBe("hierophant");
    expect(variables().myRole).toBe("hierophant");
    expect(window.history.length).toBe(historyLength);
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      null,
      "",
      expect.any(URL),
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("merges different variable edits queued before search-parameter rerender", async () => {
    mount("/doc/neophyte?locale=en#Opening");
    chooseHierophant();
    fireEvent.change(screen.getByRole("textbox", { name: "Motto" }), {
      target: { value: "A & Ω #" },
    });
    await advance();
    const url = new URL(window.location.href);
    expect(url.searchParams.get("myRole")).toBe("hierophant");
    expect(url.searchParams.get("motto")).toBe("A & Ω #");
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.hash).toBe("#Opening");
    expect(variables()).toEqual({ myRole: "hierophant", motto: "A & Ω #" });
    expect(replaceState).toHaveBeenCalledTimes(2);
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("keeps final debounced text and URL changes made while its timer is pending", async () => {
    mount("/doc/neophyte?locale=en#Opening");
    const input = screen.getByRole("textbox", { name: "Motto" });
    fireEvent.change(input, { target: { value: "Earlier" } });
    await advance(500);
    fireEvent.change(input, { target: { value: "Latest" } });
    await act(async () => {
      window.history.replaceState(
        null,
        "",
        "/doc/neophyte?locale=he&myRole=hierophant#Closing",
      );
    });
    await advance(500);
    expect(new URL(window.location.href).searchParams.has("motto")).toBe(false);
    await advance(500);
    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/doc/neophyte");
    expect(url.hash).toBe("#Closing");
    expect(url.searchParams.get("locale")).toBe("he");
    expect(url.searchParams.get("myRole")).toBe("hierophant");
    expect(url.searchParams.get("motto")).toBe("Latest");
    expect(variables()).toEqual({ myRole: "hierophant", motto: "Latest" });
    expect(router.replace).not.toHaveBeenCalled();
  });
});
