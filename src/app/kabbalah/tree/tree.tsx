"use client";

import Link from "@magick-components/Link";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React from "react";
import Data from "@/../data/data";
import Tree from "@/components/kabbalah/TreeOfLife";
import ExportControls from "@/export/ExportControls";
import { type TreeSettings, treeImageLink, treeSettings } from "./treeSettings";

type SetSetting = (key: string, value: string | boolean) => void;

// The prerendered fallback has no handler; nothing runs before hydration.
const ignoreSetting: SetSetting = () => {};

/**
 * The Tree, its controls and the Sephirah list for fixed settings. The page
 * also renders this with the defaults as its Suspense fallback, so the
 * prerendered HTML carries a complete Tree.
 */
export function TreeOfLifeView({
  settings: opts,
  onChange: set = ignoreSetting,
  sharePath = "/kabbalah/tree",
}: {
  settings: TreeSettings;
  onChange?: SetSetting;
  /** Page path and query for the copied page link. */
  sharePath?: string;
}) {
  const ref = React.useRef<SVGSVGElement>(null);
  const link = treeImageLink(opts);

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
        <Box sx={{ my: 4 }}>
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
              name="bottomText"
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
                checked={opts.flip}
                onChange={(e) => set("flip", e.target.checked)}
              />
              &nbsp; (View from Behind / Body View)
            </label>
            <br />
            <label>
              Show Da&apos;at:{" "}
              <input
                type="checkbox"
                checked={opts.showDaat}
                disabled={opts.colorScale === "king"}
                onChange={(e) => set("showDaat", e.target.checked)}
              />
              {opts.colorScale === "king" && " (Queen scale only)"}
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

          <ExportControls
            target={ref}
            filename="TreeOfLife-magickly-export"
            link={link}
            linkNote="No image link for these settings."
            share={() => sharePath}
          />
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
            <Link href="/about#credits">Image credits</Link>
          </div>
        </Box>
      </Container>
    </>
  );
}

/** Reads the settings from the query and writes changes back to it. */
export default function TreeOfLife() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";

  function set(key: string, value: string | boolean) {
    const params = new URLSearchParams(query);
    params.set(key, String(value));
    router.replace(pathname + "?" + params.toString());
  }

  return (
    <TreeOfLifeView
      settings={treeSettings(searchParams)}
      onChange={set}
      sharePath={`${pathname}${query ? `?${query}` : ""}`}
    />
  );
}
