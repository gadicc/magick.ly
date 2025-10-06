"use client";

import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React from "react";
import Data from "@/../data/data";
import Tree from "@/components/kabbalah/TreeOfLife";
import CopyPasteExport, { ToastContainer } from "@/copyPasteExport";
import Link from "@/lib/link";

/*
  Update: OLD, from pages router.  Need to re-investigate.

  The mere existance of this function changes the behaviour of how the page
  is served.  Next.js will render the page on-demand, per-request.  The
  important consequence of this is that router.query won't be empty on the
  server.  Edit: However, it prevents page cache on client / slower loading.

  See https://nextjs.org/docs/advanced-features/automatic-static-optimization
*/
/*
function getServerSideProps(context) {
  return { props: {} };
}
*/

export default function TreeOfLife() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ref = React.useRef<SVGSVGElement>(null);

  const opts: Partial<typeof defaults> = {};
  const defaults = {
    field: "name.roman",
    topText: "index",
    bottomText: "name.en",
    colorScale: "queen",
    letterAttr: "hermetic",
    flip: false as "false" | "true" | boolean,
    showDaat: false as "false" | "true" | boolean,
    fontSize: 10,
  };

  for (const key of Object.keys(defaults))
    opts[key] = searchParams?.get(key) || defaults[key];

  // From "true" / "false" to true / false
  opts.flip = opts.flip === "true";
  opts.showDaat = opts.showDaat === "true";

  function set(key, value) {
    if (!searchParams) throw new Error("no search params");
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    router.replace(pathname + "?" + params.toString());
  }

  const fields = [
    "index",
    "angelicOrder.name.en",
    "angelicOrder.name.he",
    "angelicOrder.name.roman",
    "archangel.name.roman",
    "archangel.name.he",
    "body",
    "bodyPos",
    "chakra.name.en",
    "chakra.name.sa",
    "chakra.name.roman",
    "godName.name.en",
    "godName.name.he",
    "godName.name.roman",
    "gdGrade.id",
    "gdGrade.name",
    "name.en",
    "name.he",
    "name.roman",
    "planet.name.en.en",
    "planet.name.he.he",
    "planet.name.he.roman",
    "scent",
    "stone",
    "soul.name.en",
    "soul.name.he",
    "soul.name.roman",
  ];

  return (
    <>
      <Container maxWidth="sm">
        <Box my={4}>
          <div style={{ textAlign: "center" }}>
            Top text:{" "}
            <select
              name="topText"
              value={opts.topText}
              onChange={(e) => {
                e.preventDefault();
                set("topText", e.target.value);
              }}
            >
              {fields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <br />
            Center text:{" "}
            <select
              name="field"
              value={opts.field}
              onChange={(e) => {
                e.preventDefault();
                set("field", e.target.value);
              }}
            >
              {fields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <br />
            Bottom text:{" "}
            <select
              name="topText"
              value={opts.bottomText}
              onChange={(e) => {
                e.preventDefault();
                set("bottomText", e.target.value);
              }}
            >
              {fields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <br />
            <br />
            <span>
              Color:{" "}
              <select
                name="colorScale"
                value={opts.colorScale}
                onChange={(e) => set("colorScale", e.target.value)}
              >
                <option value="king">King Scale (Projective)</option>
                <option value="queen">Queen Scale (Receptive)</option>
              </select>
            </span>
            <br />
            <span>
              Letter Attribution:{" "}
              <select
                name="letterAttr"
                value={opts.letterAttr}
                onChange={(e) => set("letterAttr", e.target.value)}
              >
                <option value="hebrew">Hebrew Tree</option>
                <option value="hermetic">Western Hermetic Tree</option>
              </select>
              &nbsp;
              <a
                target="_blank"
                rel="noreferrer"
                href="https://hermetic.com/jwmt/v1n3/32paths"
              >
                *
              </a>
            </span>
            <br />
            <label>
              Flip tree:{" "}
              <input
                type="checkbox"
                value={opts.flip.toString()}
                onChange={(e) => set("flip", e.target.checked)}
              />
              &nbsp; (View from Behind / Body View)
            </label>
            <br />
            <label>
              Show Da&apos;at:{" "}
              <input
                type="checkbox"
                value={opts.showDaat.toString()}
                onChange={(e) => set("showDaat", e.target.checked)}
              />
            </label>
          </div>

          <br />

          <Tree
            field={opts.field}
            topText={opts.topText}
            bottomText={opts.bottomText}
            colorScale={opts.colorScale}
            letterAttr={opts.letterAttr}
            flip={opts.flip}
            showDaat={opts.showDaat}
            fontSize={opts.fontSize}
            // @ts-expect-error: TODO, came up in recent linting update
            ref={ref}
          />

          <br />
          <br />

          <CopyPasteExport ref={ref} filename="TreeOfLife-magickly-export" />
          <div style={{ textAlign: "center", fontSize: "90%" }}>
            Hebrew Font:{" "}
            <a href="https://magick.ly/fonts/NotoSansHebrew-Regular.ttf">
              NotoSansHebrew-Regular.ttf
            </a>
          </div>

          <br />

          <ol>
            {Object.values(Data.sephirah).map((sephirah) => (
              <li key={sephirah.id}>
                <Link href={"/kabbalah/sephirah/" + sephirah.id}>
                  {sephirah.name.roman}
                </Link>
              </li>
            ))}
          </ol>

          <div style={{ fontSize: "60%" }}>
            <b>Credit:</b> Glyph inspired by{" "}
            <a href="https://commons.wikimedia.org/wiki/File:Tree_of_life_bahir_Hebrew.svg">
              Tree of life bahir Hebrew.svg
            </a>{" "}
            from Wikimedia Commons.
          </div>
        </Box>
      </Container>
      <ToastContainer
        position="bottom-center"
        autoClose={1500}
        hideProgressBar
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable={false}
        pauseOnHover
      />
    </>
  );
}
