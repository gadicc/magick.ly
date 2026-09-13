"use client";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useActionState } from "react";
import type { createSqlAdminService } from "@/admin/sqlAdmin";
import { createGroupAction, setGroupGrantsAction } from "./actions";

type AdminData = Awaited<
  ReturnType<ReturnType<typeof createSqlAdminService>["read"]>
>;
const initial = { message: "", error: false };

export default function AdminForms({
  data,
  newGroupId,
}: {
  data: AdminData;
  newGroupId: string;
}) {
  const [creation, create, creating] = useActionState(
    createGroupAction,
    initial,
  );
  const [update, setGrants, updating] = useActionState(
    setGroupGrantsAction,
    initial,
  );
  return (
    <Stack spacing={3} sx={{ mt: 2 }}>
      <Box>
        <Typography variant="h5" component="h2">
          Groups
        </Typography>
        <ul>
          {data.groups.map((group) => (
            <li key={group.id}>{group.name}</li>
          ))}
        </ul>
        <form action={create}>
          <input type="hidden" name="actorId" value={data.actorId} />
          <input type="hidden" name="id" value={newGroupId} />
          <TextField
            label="New group name"
            name="name"
            required
            size="small"
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <Button type="submit" disabled={creating}>
            Create group
          </Button>
        </form>
        {creation.message && (
          <Alert severity={creation.error ? "error" : "success"}>
            {creation.message}
          </Alert>
        )}
      </Box>
      <form action={setGrants}>
        <Typography variant="h5" component="h2">
          Users
        </Typography>
        <Typography sx={{ mb: 2 }}>
          Select users, then choose which group access to add or remove.
          Membership and administrator access are separate.
        </Typography>
        <input type="hidden" name="actorId" value={data.actorId} />
        <FormControl
          size="small"
          sx={{ minWidth: 180 }}
          disabled={!data.groups.length || updating}
        >
          <InputLabel id="admin-group-label">Group</InputLabel>
          <Select
            labelId="admin-group-label"
            label="Group"
            name="groupId"
            defaultValue={data.groups[0]?.id ?? ""}
          >
            {data.groups.map((group) => (
              <MenuItem key={group.id} value={group.id}>
                {group.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {(
          [
            ["add-member", "Add members"],
            ["remove-member", "Remove members"],
            ["add-admin", "Make admins"],
            ["remove-admin", "Remove admins"],
          ] as const
        ).map(([operation, label]) => (
          <Button
            key={operation}
            type="submit"
            name="operation"
            value={operation}
            disabled={updating || !data.groups.length}
          >
            {label}
          </Button>
        ))}
        {update.message && (
          <Alert severity={update.error ? "error" : "success"}>
            {update.message}
          </Alert>
        )}
        <Table aria-label="Users and group access">
          <TableHead>
            <TableRow>
              <TableCell>Select</TableCell>
              <TableCell>User</TableCell>
              <TableCell>Groups</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Checkbox
                    name="userId"
                    value={user.id}
                    disabled={updating}
                    slotProps={{
                      input: {
                        "aria-label": `Select ${user.displayName || user.name}`,
                      },
                    }}
                  />
                </TableCell>
                <TableCell>
                  {user.displayName || user.name}
                  <br />
                  {user.email}
                </TableCell>
                <TableCell>
                  {data.grants
                    .filter((grant) => grant.userId === user.id)
                    .map((grant) => (
                      <div key={grant.groupId}>
                        {data.groups.find((group) => group.id === grant.groupId)
                          ?.name ?? "Unknown group"}{" "}
                        (
                        {[grant.member && "member", grant.admin && "admin"]
                          .filter(Boolean)
                          .join(", ")}
                        )
                      </div>
                    ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </form>
    </Stack>
  );
}
