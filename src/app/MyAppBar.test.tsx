import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import MyAppBar from "./MyAppBar";

const navigation = vi.hoisted(() => ({
  pathname: "/",
  segment: null as string | null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSelectedLayoutSegment: () => navigation.segment,
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

function serverRender(pathname: string, segment: string | null = null) {
  navigation.pathname = pathname;
  navigation.segment = segment;
  return renderToString(<MyAppBar />);
}

afterEach(() => {
  navigation.pathname = "/";
  navigation.segment = null;
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

  it("titles the shared 404 page the same for every unknown path", () => {
    // Prerendered for "/_not-found", hydrated at the unknown path.
    // The browser's router reports the segment without the leading slash.
    const server = serverRender("/_not-found", "/_not-found");
    const browser = serverRender("/gd/nope", "_not-found");
    // Without the segment, /gd/nope would show the Golden Dawn breadcrumb.
    expect(serverRender("/gd/nope")).toContain("vertical-align:top");
    for (const html of [server, browser]) {
      expect(html).not.toContain("<h1");
      expect(html).not.toContain("vertical-align:top");
      expect(html).toContain(">Magick.ly</div>");
    }
    // Sign-in still returns to the path the reader opened.
    expect(browser).toContain('href="/signin?callbackURL=%2Fgd%2Fnope"');
  });

  it("shows the site name below a titled section", () => {
    const html = serverRender("/kabbalah/sephirah/keter");
    expect(html).not.toContain("<h1");
    expect(html).toContain('<span style="vertical-align:top">Magick.ly</span>');
  });
});
