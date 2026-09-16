import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import MyAppBar from "./MyAppBar";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  // Static prerendering bails out of anything that reads the query.
  useSearchParams: () => {
    throw new Error("Bail out to client-side rendering: useSearchParams()");
  },
}));
vi.mock("@/auth/client", () => ({
  useSession: () => ({ data: null, isPending: true }),
}));
vi.mock("@/auth/browserLifecycle", () => ({ sqlBrowserLifecycle: {} }));
vi.mock("./clientProviders", () => ({
  useLegacyRecoveryGate: () => ({ state: "checking", retry: () => {} }),
}));

function serverRender(pathname: string) {
  navigation.pathname = pathname;
  return renderToString(<MyAppBar />);
}

afterEach(() => {
  navigation.pathname = "/";
});

describe("MyAppBar on the server", () => {
  it("renders the page title as the heading without the query", () => {
    const html = serverRender("/kabbalah/tree");
    expect(html).toMatch(/<h1[^>]*>.*Tree of Life.*<\/h1>/);
    // The sign-in link waits for the query; its fallback keeps the path.
    expect(html).toContain('href="/signin?callbackURL=%2Fkabbalah%2Ftree"');
    expect(html).toContain('aria-label="share"');
  });

  it("names the site in a heading on the home page", () => {
    expect(serverRender("/")).toMatch(/<h1[^>]*>Magick\.ly<\/h1>/);
  });

  it("keeps untitled pages out of the heading", () => {
    for (const pathname of ["/doc/neophyte", "/constructor", "/gd/toString"]) {
      const html = serverRender(pathname);
      expect(html, pathname).not.toContain("<h1");
      expect(html, pathname).toContain("Magick.ly");
    }
  });

  it("shows the site name below a titled section", () => {
    const html = serverRender("/kabbalah/sephirah/keter");
    expect(html).not.toContain("<h1");
    expect(html).toContain('<span style="vertical-align:top">Magick.ly</span>');
  });
});
