"use client";
import React, { useState } from "react";
import {
  db,
  useGongoOne,
  useGongoUserId,
  useGongoSub,
  useGongoLive,
} from "gongo-client-react";

import {
  Box,
  Button,
  Container,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Edit } from "@mui/icons-material";

import Link from "@/lib/link";
import {
  Doc,
  Temple,
  TempleMembershipClient as TempleMembership,
} from "@/schemas";

const builtInDocs = [
  {
    _id: "neophyte",
    title: "0=0 Grade of the Neophyte",
  },
  {
    _id: "zelator",
    title: "1=10 Grade of the Zelator",
  },
  {
    _id: "theoricus",
    title: "2=9 Grade of the Theoricus",
  },
];

function DocAdmin() {
  const userId = useGongoUserId() as string;
  const user = useGongoOne((db) =>
    db.collection("users").find({ _id: userId })
  );

  useGongoSub("userTemplesAndMemberships");
  const _memberships = useGongoLive((db) =>
    db.collection("templeMemberships").find({ admin: true })
  );
  const temples = useGongoLive((db) => db.collection("temples").find());
  const memberships = React.useMemo(
    () =>
      _memberships.map((membership) => ({
        ...membership,
        temple: temples.find((t) => t._id === membership.templeId),
      })),
    [_memberships, temples]
  );

  const groups = useGongoLive((db) => db.collection("userGroups").find());
  useGongoSub("userGroups");

  const [title, setTitle] = React.useState("");
  // const [groupId, setGroupId] = React.useState("");
  const [templeId, setTempleId] = React.useState("");
  const [minGrade, setMinGrade] = React.useState("0");

  if (!(user && user.groupAdminIds && user.groupAdminIds.length)) return null;

  function addNew(event: React.SyntheticEvent) {
    event.preventDefault();

    const doc = {
      title,
      doc: { type: "root", children: [] },
      userId,
      // groupId,
      templeId,
      minGrade: Number(minGrade),
      createdAt: new Date(),
      __ObjectIDs: ["templeId", "userId"],
    } as {
      title: string;
      doc: { type: "root"; children: [] }; // TODO
      userId: string;
      // groupId?: string;
      templeId?: string;
      minGrade?: number;
      createdAt: Date;
    };
    // if (!groupId || groupId === "" || groupId === "public") delete doc.groupId;
    if (!templeId || templeId === "" || templeId === "public")
      delete doc.templeId;

    console.log(doc);
    db.collection("docs").insert(doc);
    setTitle("");
    setTempleId("");
    setMinGrade("0");
  }

  return (
    <Box>
      <br />
      <Typography variant="h6" sx={{ my: 1 }}>
        Create Doc
      </Typography>
      <form onSubmit={addNew}>
        <TextField
          label="Title"
          size="small"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />{" "}
        {/*
        <FormControl sx={{ minWidth: 180 }} size="small">
          <InputLabel id="select-label-groupId">Group</InputLabel>
          <Select
            value={groupId}
            labelId="select-label-groupId"
            label="Group"
            onChange={(e) => setGroupId(e.target.value)}
          >
            <MenuItem value="none">None (Public)</MenuItem>
            {user &&
              user.groupAdminIds &&
              user.groupAdminIds.map((gid) => (
                <MenuItem key={gid} value={gid}>
                  {db.collection("userGroups").findOne(gid)?.name}
                </MenuItem>
              ))}
          </Select>
        </FormControl>
        */}
        <FormControl sx={{ minWidth: 180 }} size="small">
          <InputLabel id="select-label-templeId">Temple</InputLabel>
          <Select
            value={templeId}
            labelId="select-label-templeId"
            label="Group"
            onChange={(e) => setTempleId(e.target.value)}
          >
            <MenuItem value="none">None (Public)</MenuItem>
            {memberships.map((membership) => (
              <MenuItem key={membership.templeId} value={membership.templeId}>
                {membership.temple?.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          label="Min Grade"
          size="small"
          value={minGrade}
          type="number"
          onChange={(e) => setMinGrade(e.target.value)}
          sx={{ width: 70 }}
        />
        <Button type="submit" disabled={title === "" || templeId === ""}>
          Add
        </Button>
      </form>
    </Box>
  );
}

/*
async function editDoc(id) {
  const contents = prompt("Paste contents");
  if (!contents) return;

  const prepared = prepare(contents);
  db.collection("docs").update(id, {
    $set: {
      doc: prepared,
    },
  });
}
*/

export default function Rituals() {
  const userId = useGongoUserId() as string;
  const user = useGongoOne((db) =>
    db.collection("users").find({ _id: userId })
  );

  useGongoSub("userTemplesAndMemberships");
  const _templeMemberships = useGongoLive((db) =>
    db.collection("templeMemberships").find({ userId })
  );
  const templeMemberships = React.useMemo(
    () => Object.fromEntries(_templeMemberships.map((tm) => [tm.templeId, tm])),
    [_templeMemberships]
  );

  const _temples = useGongoLive((db) => db.collection("temples").find());
  const temples = React.useMemo(
    () => Object.fromEntries(_temples.map((t) => [t._id, t])),
    [_temples]
  );
  // console.log("temples", temples);

  useGongoSub("docs");
  const dbDocs = useGongoLive((db) => db.collection("docs").find());
  const _docs = React.useMemo(
    () => [...builtInDocs, ...dbDocs] as unknown as typeof dbDocs,
    [dbDocs]
  );

  type AggregatedDoc = Doc & { temple?: Temple; membership?: TempleMembership };
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
            : doc
        )
        .filter((doc: AggregatedDoc) => {
          if (!doc.templeId) return true;
          // TODO, re should also remove the doc in this case XXX
          if (!doc.membership) return false;
          return (
            !doc.minGrade ||
            doc.membership.admin ||
            doc.minGrade <= doc.membership.grade
          );
        }),
    [_docs, temples, templeMemberships]
  );

  const navParts = [{ title: "HOGD", url: "/hogd" }];
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
                    {doc.templeId && templeMemberships[doc.templeId]?.admin && (
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
