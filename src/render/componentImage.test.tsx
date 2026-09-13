import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import React from "react";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { calls } = vi.hoisted(() => ({ calls: vi.fn() }));
vi.mock("@/components/kabbalah/TreeOfLife", () => ({
  default: (props) => {
    calls(props);
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="-170.5 0 341 598"
        id="TreeOfLife"
        width={props.width || "100%"}
        height={props.height}
      >
        <circle cx="-80" cy="100" r="40" fill="red" />
        <text x="-80" y="105">
          {props.field}
        </text>
      </svg>
    );
  },
}));

import { GET as canonicalGet } from "@/app/api/render/[slug]/route";
import { GET as legacyGet } from "@/app/api/treeOfLife/route";
import { renderComponentImage } from "./componentImage";
import { componentImageResponse } from "./componentImageResponse";

beforeEach(() => calls.mockClear());

describe("component image service and routes", () => {
  it("keeps canonical and saved URLs on identical SVG bytes", async () => {
    const query = "field=name.roman&topText=&bottomText=index&width=200";
    const legacy = await legacyGet(
      new Request(`https://example.com/api/treeOfLife?${query}`),
    );
    const canonical = await canonicalGet(
      new Request(`https://example.com/api/render/tree-of-life?${query}`),
      {
        params: Promise.resolve({ slug: "tree-of-life" }),
      },
    );
    expect(canonical.status).toBe(200);
    const bytes = await canonical.arrayBuffer();
    expect(bytes).toEqual(await legacy.arrayBuffer());
    expect(canonical.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(canonical.headers.get("Content-Length")).toBe(
      String(bytes.byteLength),
    );
    expect(canonical.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(calls.mock.calls[0][0]).toMatchObject({
      field: "name.roman",
      topText: "",
      bottomText: "index",
      width: 200,
    });
  });

  it.each([
    ["fmt=png", 341, 598],
    ["fmt=png&width=200&height=300", 200, 300],
    ["fmt=png&width=200", 200, 351],
    ["fmt=png&height=300", 171, 300],
  ])(
    "returns fully decoded PNG with expected dimensions for %s",
    async (query, width, height) => {
      const result = await renderComponentImage(
        "tree-of-life",
        new URLSearchParams(query),
      );
      expect(result.contentType).toBe("image/png");
      const decoded = await sharp(result.bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(decoded.info).toMatchObject({ width, height, channels: 4 });
      expect(decoded.data.length).toBe(width * height * 4);
    },
  );

  it("applies flip after outlining, without the component's unsupported 3D CSS", async () => {
    const result = await renderComponentImage(
      "tree-of-life",
      new URLSearchParams("flip=true"),
    );
    expect(calls.mock.calls[0][0].flip).toBe(false);
    expect(result.bytes.toString()).toContain('transform="scale(-1 1)"');
  });

  it("binds normalized props and final bytes, including post-source flip/format", async () => {
    const ordinary = await renderComponentImage(
      "tree-of-life",
      new URLSearchParams(),
    );
    const flipped = await renderComponentImage(
      "tree-of-life",
      new URLSearchParams("flip=true"),
    );
    const png = await renderComponentImage(
      "tree-of-life",
      new URLSearchParams("fmt=png"),
    );
    for (const result of [ordinary, flipped, png]) {
      expect(result.sha256).toBe(
        createHash("sha256").update(result.bytes).digest("hex"),
      );
      expect(result.byteSize).toBe(result.bytes.length);
    }
    expect(flipped.sourceSha256).toBe(ordinary.sourceSha256);
    expect(png.sourceSha256).toBe(ordinary.sourceSha256);
    expect(new Set([ordinary.sha256, flipped.sha256, png.sha256]).size).toBe(3);
    expect(flipped.request.props.flip).toBe(true);
    expect(png.request.format).toBe("png");
  });

  it.each([
    "labels=custom",
    "field=__proto__",
    "width=9999",
    "field=index&field=name.en",
  ])("rejects %s before JSX and image allocation", async (query) => {
    const response = await legacyGet(
      new Request(`https://example.com/api/treeOfLife?${query}`),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("Unsupported component image request");
    expect(calls).not.toHaveBeenCalled();
  });

  it("rejects unknown registry entries without treating them as module names", async () => {
    const response = await componentImageResponse(
      "__proto__",
      new Request("https://example.com/api/render/__proto__"),
    );
    expect(response.status).toBe(400);
    expect(calls).not.toHaveBeenCalled();
  });

  it("keeps renderer infrastructure failures distinguishable from bad requests", async () => {
    calls.mockImplementationOnce(() => {
      throw new Error("fixture render failure");
    });
    await expect(
      legacyGet(new Request("https://example.com/api/treeOfLife")),
    ).rejects.toThrow("fixture render failure");
  });

  it("covers the saved built-in ritual URL in the closed registry", async () => {
    const jade = await readFile("src/doc/2=9.jade", "utf8");
    const reference = jade.match(/\/api\/treeOfLife\?[^"'\s)]+/)?.[0];
    expect(reference).toBeDefined();
    expect(
      (await legacyGet(new Request(`https://example.com${reference}`))).status,
    ).toBe(200);
  });
});
