"use client";
import { AdminPanelSettings } from "@mui/icons-material";
import {
  Box,
  Button,
  Container,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { db, useGongoLive, useGongoSub } from "gongo-client-react";
import React from "react";

import { UserClient, UserGroup } from "@/schemas";

function Groups({ groups }: { groups: UserGroup[] }) {
  const [groupName, setGroupName] = React.useState("");

  function onSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    db.collection("userGroups").insert({ name: groupName });
    setGroupName("");
  }

  return (
    <Box>
      <Typography variant="h5">Groups</Typography>
      <ul>
        {groups.map((group) => (
          <li key={group._id}>{group.name}</li>
        ))}
      </ul>
      <form onSubmit={onSubmit}>
        Add New Group
        <br />
        <TextField
          name="name"
          size="small"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
        />
        <br />
        <Button type="submit">Submit</Button>
      </form>
    </Box>
  );
}

function UserRow({
  user,
  selected,
  toggleRow,
}: {
  user: UserClient;
  selected: boolean;
  toggleRow: (string) => void;
}) {
  return (
    <TableRow
      key={user._id}
      onClick={() => toggleRow(user._id)}
      style={{
        background: selected ? "#ffa" : "",
      }}
    >
      <TableCell width={50}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => {
            /* bubbles through to TR.click toggleRow */
          }}
        />
      </TableCell>
      <TableCell>
        {user.displayName}
        <br />
        {user.emails?.[0]?.value}
      </TableCell>
      <TableCell>
        {user.groupIds &&
          user.groupIds.map((groupId) => {
            const group =
              groupId && db.collection("userGroups").findOne(groupId);
            const groupName = group ? group.name : "Unknown";
            return (
              <>
                {groupName}{" "}
                {user.groupAdminIds && user.groupAdminIds.includes(groupId) && (
                  <AdminPanelSettings />
                )}
              </>
            );
          })}
      </TableCell>
    </TableRow>
  );
}

function addTo(
  field: "groupIds" | "groupAdminIds",
  selected: string[],
  groupId: string,
) {
  for (const id of selected) {
    // @ts-expect-error: this is not sustainable!
    db.collection("users").update(id, {
      $push: {
        [field]: groupId,
      },
    });
  }
}

function removeFrom(
  field: "groupIds" | "groupAdminIds",
  selected: string[],
  groupId: string,
) {
  const Users = db.collection("users");
  for (const id of selected) {
    // ModifyJSError: $pull not implemented yet
    // db.collection("users").update(id, { $pull: { groupIds: groupId } });

    const existingGroupIds = Users.findOne(id)?.[field] || [];
    const newGroupIds = existingGroupIds.filter((gid) => gid != groupId);
    Users.update(id, { $set: { [field]: newGroupIds } });
  }
}

function Users({
  users,
  groups,
  selected,
  setSelected,
}: {
  users: UserClient[];
  groups: UserGroup[];
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const [groupId, setGroupId] = React.useState(groups[0] ? groups[0]._id : "");
  React.useEffect(() => {
    // groupId === "" if first useState call happened before data fully loaded.
    if (groupId === "" && groups[0]) setGroupId(groups[0]._id);
  }, [groups, groupId]);

  const addToGroup = addTo.bind(null, "groupIds", selected, groupId);
  const removeFromGroup = removeFrom.bind(null, "groupIds", selected, groupId);
  const addToGroupAdmins = addTo.bind(null, "groupAdminIds", selected, groupId);
  const removeFromGroupAdmins = removeFrom.bind(
    null,
    "groupAdminIds",
    selected,
    groupId,
  );

  function toggleRow(_id) {
    if (selected.includes(_id)) setSelected(selected.filter((id) => id != _id));
    else setSelected([...selected, _id]);
  }

  return (
    <Box>
      <Typography variant="h5">Users</Typography>
      <form>
        Group:{" "}
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((group) => (
            <option key={group._id} value={group._id}>
              {group.name}
            </option>
          ))}
        </select>
        <Button onClick={addToGroup}>Add To</Button>
        <Button onClick={removeFromGroup}>Remove From</Button>
        <Button onClick={addToGroupAdmins}>Make Admin</Button>
        <Button onClick={removeFromGroupAdmins}>Remove Admin</Button>
      </form>
      <TableContainer component={Paper}>
        <Table>
          <TableBody>
            {users.map((user) => (
              <UserRow
                key={user._id}
                user={user}
                selected={selected.includes(user._id)}
                toggleRow={toggleRow}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default function Admin() {
  useGongoSub("users");
  useGongoSub("userGroups");
  const users = useGongoLive((db) => db.collection("users").find());
  const groups = useGongoLive((db) => db.collection("userGroups").find());
  const [selectedUsers, setSelectedUsers] = React.useState<string[]>([]);

  return (
    <Container sx={{ my: 1 }}>
      <Groups groups={groups} />
      <Users
        users={users}
        groups={groups}
        selected={selectedUsers}
        setSelected={setSelectedUsers}
      />
    </Container>
  );
}
