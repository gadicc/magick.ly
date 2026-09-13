"use server";

import { revalidatePath } from "next/cache";
import {
  createSqlAdminService,
  type GroupGrantOperation,
  SqlAdminError,
} from "@/admin/sqlAdmin";
import { getCurrentSqlUserId } from "@/auth/session";
import { db } from "@/db/neonFull";

export interface AdminActionState {
  message: string;
  error: boolean;
}
const service = createSqlAdminService(db, getCurrentSqlUserId);
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};
function failure(error: unknown): AdminActionState {
  const message =
    error instanceof SqlAdminError
      ? {
          NOT_AUTHENTICATED: "Sign in to continue.",
          FORBIDDEN: "Global administrator access is required.",
          INVALID: "Check the name, group and selected users.",
          CHANGED:
            "The account or pending request changed. Reload before continuing.",
        }[error.code]
      : "We could not confirm the update. Retry the same request to check its result.";
  return { message, error: true };
}

export async function createGroupAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  try {
    await service.createGroup({
      expectedActorId: text(form, "actorId"),
      id: text(form, "id"),
      name: text(form, "name"),
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/admin");
  return { message: "Group created.", error: false };
}

export async function setGroupGrantsAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  try {
    const userIds = form.getAll("userId");
    if (userIds.some((value) => typeof value !== "string"))
      throw new SqlAdminError("INVALID");
    await service.setGrants({
      expectedActorId: text(form, "actorId"),
      groupId: text(form, "groupId"),
      userIds: userIds as string[],
      operation: text(form, "operation") as GroupGrantOperation,
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/admin");
  return { message: "Group access updated.", error: false };
}
