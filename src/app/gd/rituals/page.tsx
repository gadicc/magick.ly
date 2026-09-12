"use client";
import { Edit } from "@mui/icons-material";
import {
  Box,
  Container,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import { useGongoLive, useGongoSub, useGongoUserId } from "gongo-client-react";
import React from "react";

import { ritualListSubscriptionArgs } from "@/doc/drafts";
import Link from "@/lib/link";
import {
  Doc,
  Temple,
  TempleMembershipClient as TempleMembership,
} from "@/schemas";
import DocAdmin from "./DocAdmin";

const builtInDocs = [
  {
    _id: "neophyte",
    title: "0=0 Grade of the Neophyte (Regardie, S.M.)",
  },
  {
    _id: "zelator",
    title: "1=10 Grade of the Zelator (Regardie, S.M.)",
  },
  {
    _id: "theoricus",
    title: "2=9 Grade of the Theoricus (Regardie, S.M.)",
  },
];

export default function Rituals() {
  const userId = useGongoUserId() as string;
  /*
  const user = useGongoOne((db) =>
    db.collection("users").find({ _id: userId }),
  );
  */

  useGongoSub("userTemplesAndMemberships");
  const _templeMemberships = useGongoLive((db) =>
    db.collection("templeMemberships").find({ userId }),
  );
  const templeMemberships = React.useMemo(
    () => Object.fromEntries(_templeMemberships.map((tm) => [tm.templeId, tm])),
    [_templeMemberships],
  );

  const _temples = useGongoLive((db) => db.collection("temples").find());
  const temples = React.useMemo(
    () => Object.fromEntries(_temples.map((t) => [t._id, t])),
    [_temples],
  );
  // console.log("temples", temples);

  useGongoSub("docs", ritualListSubscriptionArgs);
  const dbDocs = useGongoLive((db) => db.collection("docs").find());
  const _docs = React.useMemo(
    () =>
      [
        ...builtInDocs,
        ...dbDocs.filter((doc) => !doc.__pendingSince),
      ] as unknown as typeof dbDocs,
    [dbDocs],
  );

  type AggregatedDoc = Doc & {
    canEdit?: boolean;
    temple?: Temple;
    membership?: TempleMembership;
  };
  const docs: AggregatedDoc[] = React.useMemo(
    () =>
      _docs
        .map((doc) =>
          doc.templeId
            ? {
                ...doc,
                temple: temples[doc.templeId],
                membership: templeMemberships[doc.templeId],
              }
            : doc,
        )
        .filter((doc: AggregatedDoc) => {
          if (doc.canEdit === true || !doc.templeId) return true;
          // TODO, re should also remove the doc in this case XXX
          if (!doc.membership) return false;
          return (
            !doc.minGrade ||
            doc.membership.admin ||
            doc.minGrade <= doc.membership.grade
          );
        }),
    [_docs, temples, templeMemberships],
  );

  return (
    <Container maxWidth="sm">
      <Box>
        <p>
          A collection of well publicized documents, remodelled for clearer
          visibility and various form factors (e.g. mobile), with additional
          helpful features. See a{" "}
          <a href="https://www.youtube.com/watch?v=iEFiXtxPxu0">short demo</a>.
        </p>
        <TableContainer component={Paper}>
          <Table aria-label="simple table">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {docs.map((doc) => (
                <TableRow key={doc._id}>
                  <TableCell scope="row">
                    <Link href={"/doc/" + doc._id}>{doc.title}</Link>
                    {doc.temple ? (
                      <span
                        style={{
                          fontSize: "80%",
                          margin: "0 5px 0 5px",
                          padding: "2px 5px 2px 5px",
                          background: "#dfdfdf",
                          borderRadius: 5,
                        }}
                      >
                        {doc.temple.slug}
                      </span>
                    ) : null}{" "}
                    {doc.canEdit === true && (
                      <IconButton size="small" href={`/doc/${doc._id}/edit`}>
                        <Edit />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <DocAdmin />
        <br />
        <p>
          Note: You&apos;ll only find material here that is readily available
          elsewhere. However, if you&apos;re the head of an order and want
          private materials made available securely to your members, please
          contact me.
        </p>
        <p>
          Image credit:{" "}
          <a href="https://commons.wikimedia.org/wiki/File:Anxfisa_Golden_Dawn_Robes.jpg">
            Anxfisa Golden Dawn Robes.jpg
          </a>{" "}
          (CC BY-SA 3.0).
        </p>
      </Box>
    </Container>
  );
}
