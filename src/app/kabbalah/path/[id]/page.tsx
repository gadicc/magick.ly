"use client";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import { decycle } from "cycle";
import Image from "next/legacy/image";
import React from "react";
import Data from "@/../data/data";

import TreeOfLife from "@/components/kabbalah/TreeOfLife";
import Link from "@/lib/link";
import { RWSPath, tarotDeck } from "@/tarot";

const paths = Object.values(Data.tolPath);

/*
export async function getStaticPaths() {
  const urlPaths = paths.map((path) => "/kabbalah/path/" + path.id);
  return { paths: urlPaths, fallback: true };
}

export async function getStaticProps({ params: { id } }) {
  return { props: { id } };
}
*/

export default function Sephirot(props: { params: Promise<{ id: string }> }) {
  const params = React.use(props.params);

  const { id } = params;

  if (!id) return "No id";

  const path = paths.find((path) => path.id === id);
  if (!path) return null;

  const otherLabels = Object.keys(path).filter(
    (x) => !["id", "hermetic", "hebrew"].includes(x),
  );

  const [from, to] = path.id
    .split("_")
    .map(Number)
    .map((i) => Object.values(Data.sephirah).find((s) => s.index === i));

  const tarotCard =
    path.hermetic && tarotDeck.getByRank(Number(path.hermetic.tarotId));
  const tarotImg = path.hermetic && RWSPath(path.hermetic.tarotId);

  return (
    <>
      <style jsx>{`
        .hebrewLetter:nth-child(1) {
          width: 100px;
          border: 1px outset;
          background: #eee;
          text-align: center;
          padding: 5px;
        }
        .hebrewLetter > div:nth-child(1) {
          font-size: 500%;
          line-height: 0.8em;
        }

        table.main {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0 20px;
        }
        table.main td {
          display: table-cell;
          vertical-align: middle;
        }
      `}</style>
      <Container maxWidth="sm">
        <Box my={4}>
          <div className="nav">
            <div className="prevNext">
              {"prev" in path && (
                <Link href={path.prev as string} underline="none">
                  ❮
                </Link>
              )}
            </div>
            <div>
              <TreeOfLife height="150px" topText="" activePath={path.id} />
            </div>
            <div className="prevNext">
              {"next" in path && (
                <Link href={path.next as string} underline="none">
                  ❯
                </Link>
              )}
            </div>
          </div>
          <br />

          {/*
<span style={{ right: 0, marginRight: 15, position: 'fixed' }}>
<TreeOfLife width="80px" topText="" active={sephirah.id} />
</span>
*/}

          <h1>
            Path {path.id.replace(/_/, "-")} ({from?.name.roman}-
            {to?.name.roman})
          </h1>

          <h2>Hermetic Tradition</h2>

          {path.hermetic ? (
            <table className="main">
              <tbody>
                <tr>
                  <td>Path No:</td>
                  <td>{path.hermetic.pathNo}</td>
                </tr>

                <tr>
                  <td>Hebrew Letter:</td>
                  <td>
                    <div className="hebrewLetter">
                      <div>{path.hermetic.hebrewLetter?.letter.he}</div>
                      <div>
                        {path.hermetic.hebrewLetter?.letter.name} (&quot;
                        {
                          // @ts-expect-error: later
                          path.hermetic.hebrewLetter?.letter.mathers
                        }
                        &quot;)
                      </div>
                    </div>
                  </td>
                </tr>

                <tr>
                  <td>Tarot:</td>
                  <td>
                    <div>
                      <div>
                        <Image
                          src={tarotImg}
                          alt={tarotCard.name}
                          width={100}
                          height={176}
                        />
                      </div>
                      <div>
                        {tarotCard.name} ({tarotCard.rank})
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div>Not mentioned in Hermetic Tradition</div>
          )}

          <table className="main">
            <tbody>
              {otherLabels.map((key) => (
                <tr key={key}>
                  <td>{key.substr(0, 1).toUpperCase() + key.substr(1)}:</td>
                  <td>
                    {typeof path[key] === "string"
                      ? path[key].substr(0, 1).toUpperCase() +
                        path[key].substr(1)
                      : JSON.stringify(decycle(path[key]))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </Container>
    </>
  );
}
