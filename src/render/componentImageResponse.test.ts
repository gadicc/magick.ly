import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("./componentImage", () => ({ renderComponentImage: mocks.render }));

import { parseComponentImageRequest } from "./componentImageRequest";
import {
  COMPONENT_IMAGE_CACHE_CONTROL,
  componentImageResponse,
} from "./componentImageResponse";

function rendered(slug: string, query: string) {
  const request = parseComponentImageRequest(slug, new URLSearchParams(query));
  const bytes = Buffer.from(`<svg>${slug}</svg>`);
  return {
    request,
    bytes,
    byteSize: bytes.length,
    sha256: "abc123",
    contentType:
      request.format === "svg" ? "image/svg+xml" : ("image/png" as const),
  };
}

beforeEach(() => {
  mocks.render.mockReset();
  mocks.render.mockImplementation(
    async (slug: string, params: URLSearchParams) =>
      rendered(slug, params.toString()),
  );
});

describe("component image responses", () => {
  it("serves inline images with an ETag, edge caching and a file name", async () => {
    const response = await componentImageResponse(
      "tree-of-life",
      new Request("https://magick.ly/api/render/tree-of-life?field=name.roman"),
    );
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "image/svg+xml",
      "content-length": String(Buffer.byteLength("<svg>tree-of-life</svg>")),
      "x-content-type-options": "nosniff",
      "cache-control": COMPONENT_IMAGE_CACHE_CONTROL,
      etag: '"abc123"',
      "content-disposition": 'inline; filename="tree-of-life.svg"',
    });
    expect(response.headers.has("x-robots-tag")).toBe(false);
    expect(await response.text()).toBe("<svg>tree-of-life</svg>");
    expect(mocks.render).toHaveBeenCalledWith(
      "tree-of-life",
      new URLSearchParams("field=name.roman"),
    );
  });

  it("returns 304 for a matching ETag, including weak and list forms", async () => {
    for (const header of ['"abc123"', 'W/"abc123"', '"x", "abc123"', "*"]) {
      const response = await componentImageResponse(
        "tree-of-life",
        new Request("https://magick.ly/api/treeOfLife", {
          headers: { "if-none-match": header },
        }),
      );
      expect(response.status).toBe(304);
      expect(response.headers.get("etag")).toBe('"abc123"');
      expect(response.headers.get("cache-control")).toBe(
        COMPONENT_IMAGE_CACHE_CONTROL,
      );
      expect(response.headers.has("content-length")).toBe(false);
      expect(await response.text()).toBe("");
    }
    const fresh = await componentImageResponse(
      "tree-of-life",
      new Request("https://magick.ly/api/treeOfLife", {
        headers: { "if-none-match": '"other"' },
      }),
    );
    expect(fresh.status).toBe(200);
  });

  it("turns download=1 into an attachment without changing the render request", async () => {
    const response = await componentImageResponse(
      "rose-sigil",
      new Request(
        "https://magick.ly/api/render/rose-sigil?fmt=png&text=%D7%92%D7%93%D7%99&download=1",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"rose-sigil-___.png\"; filename*=UTF-8''rose-sigil-%D7%92%D7%93%D7%99.png",
    );
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(mocks.render.mock.calls[0][1].toString()).toBe(
      "fmt=png&text=%D7%92%D7%93%D7%99",
    );
  });

  it("gives the attachment URL the inline URL's ETag, bytes and 304", async () => {
    const inline = await componentImageResponse(
      "tree-of-life",
      new Request("https://magick.ly/api/render/tree-of-life?field=name.roman"),
    );
    const attachment = await componentImageResponse(
      "tree-of-life",
      new Request(
        "https://magick.ly/api/render/tree-of-life?field=name.roman&download=1",
      ),
    );
    expect(attachment.headers.get("etag")).toBe(inline.headers.get("etag"));
    expect(await attachment.text()).toBe(await inline.text());
    expect(mocks.render.mock.calls[1][1].toString()).toBe(
      mocks.render.mock.calls[0][1].toString(),
    );
    const cached = await componentImageResponse(
      "tree-of-life",
      new Request(
        "https://magick.ly/api/render/tree-of-life?field=name.roman&download=1",
        { headers: { "if-none-match": '"abc123"' } },
      ),
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.get("content-disposition")).toContain("attachment");
  });

  it.each([
    "download=0",
    "download=",
    "download=1&download=1",
    "download=true",
  ])(
    "rejects malformed download flags (%s) before rendering",
    async (query) => {
      const response = await componentImageResponse(
        "tree-of-life",
        new Request(`https://magick.ly/api/render/tree-of-life?${query}`),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.render).not.toHaveBeenCalled();
    },
  );

  it("keeps bad requests and renderer failures distinct", async () => {
    const bad = await componentImageResponse(
      "nope",
      new Request("https://magick.ly/api/render/nope"),
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toBe("Unsupported component image request");
    mocks.render.mockRejectedValueOnce(new Error("wasm failure"));
    await expect(
      componentImageResponse(
        "tree-of-life",
        new Request("https://magick.ly/api/render/tree-of-life"),
      ),
    ).rejects.toThrow("wasm failure");
  });
});
