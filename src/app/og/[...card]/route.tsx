import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { CARD_ART_BOX, cardArtDataUrl } from "@/seo/cardArt";
import { socialCards } from "@/seo/cardList";
import { CARD_SIZE } from "@/seo/cards";
import { SITE_NAME } from "@/seo/site";

// Every card is drawn at build time; unknown paths are 404s, never renders.
export const dynamicParams = false;

export function generateStaticParams() {
  return socialCards().map((card) => ({ card: card.segments }));
}

const FONTS = [
  ["Noto Sans", "NotoSans-Regular.ttf"],
  // Planet symbols in titles fall back to these.
  ["Noto Sans Symbols", "NotoSansSymbols-Regular.ttf"],
  ["Noto Sans Symbols 2", "NotoSansSymbols2-Regular.ttf"],
] as const;

const readAsset = (file: string) => readFile(path.join(process.cwd(), file));

async function loadFonts() {
  return Promise.all(
    FONTS.map(async ([name, file]) => ({
      name,
      data: await readAsset(`public/fonts/${file}`),
      weight: 400 as const,
      style: "normal" as const,
    })),
  );
}

function titleSize(title: string) {
  if (title.length <= 22) return 76;
  if (title.length <= 40) return 64;
  return 54;
}

/** A 1200×630 sharing card: section, page title, site mark and art. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/og/[...card]">,
) {
  const key = (await params).card.join("/");
  const card = socialCards().find(
    (candidate) => candidate.segments.join("/") === key,
  );
  if (!card) return new Response("Not found", { status: 404 });
  const [fonts, art, mark] = await Promise.all([
    loadFonts(),
    cardArtDataUrl(card.art),
    readAsset("public/pentagram.png"),
  ]);
  const image = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        padding: "0 60px",
        gap: 56,
        fontFamily: "Noto Sans",
        color: "#ffffff",
        backgroundImage:
          "linear-gradient(135deg, #120d2b 0%, #24174f 55%, #3b2878 100%)",
      }}
    >
      <div
        style={{
          flex: 1,
          height: CARD_ART_BOX.height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            fontSize: 28,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: "#e6b84f",
          }}
        >
          {card.section}
        </div>
        <div style={{ fontSize: titleSize(card.title), lineHeight: 1.15 }}>
          {card.title}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 32,
              backgroundColor: "#f4efe4",
            }}
          >
            {/* biome-ignore lint/performance/noImgElement: next/og draws plain img */}
            <img
              src={`data:image/png;base64,${mark.toString("base64")}`}
              width={50}
              height={50}
              alt=""
            />
          </div>
          <div style={{ fontSize: 36, color: "#d4ceff" }}>{SITE_NAME}</div>
        </div>
      </div>
      <div
        style={{
          ...CARD_ART_BOX,
          display: "flex",
          borderRadius: 24,
          overflow: "hidden",
          backgroundColor: "#f4efe4",
        }}
      >
        {/* biome-ignore lint/performance/noImgElement: next/og draws plain img */}
        <img src={art} {...CARD_ART_BOX} alt="" />
      </div>
    </div>,
    { ...CARD_SIZE, fonts },
  );
  // A palette keeps photo cards to about a fifth of next/og's output
  // without visible banding, and ~95 cards ship with every deployment.
  const png = await sharp(Buffer.from(await image.arrayBuffer()))
    .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
    .toBuffer();
  const headers = new Headers(image.headers);
  headers.delete("content-length");
  return new Response(new Uint8Array(png), { headers });
}
