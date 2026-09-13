"use server";

import { redirect } from "next/navigation";
import { getCurrentSqlUserId } from "@/auth/session";
import { db } from "@/db/neonFull";
import { createSqlTempleCreator } from "@/temples/create";
import { createSqlTempleWriter } from "@/temples/sql";

export interface CreateTempleFormState {
  error: string | null;
}

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function signInPath(callbackURL: string) {
  return `/signin?${new URLSearchParams({ callbackURL }).toString()}`;
}

function templeErrorPath(path: string, message: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${new URLSearchParams({ error: message }).toString()}`;
}

function validRouteValue(value: string) {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes("/") &&
    !value.includes("\0") &&
    value.isWellFormed()
  );
}

/** Creates a new organization and its first administrator as one SQL command. */
export async function createTempleAction(
  _previous: CreateTempleFormState,
  formData: FormData,
): Promise<CreateTempleFormState> {
  const create = createSqlTempleCreator(db, getCurrentSqlUserId);
  const result = await create({
    version: 1,
    operationId: field(formData, "operationId"),
    expectedActorId: field(formData, "expectedActorId"),
    name: field(formData, "name"),
  });
  if (!result.ok) return { error: result.message };
  redirect(`/temples/admin/${result.templeId}`);
}

/** Starts the join confirmation flow without changing membership. */
export async function startTempleJoin(formData: FormData) {
  const slug = field(formData, "slug");
  const joinPass = field(formData, "joinPass");
  if (!validRouteValue(slug) || !validRouteValue(joinPass))
    redirect(templeErrorPath("/temples", "Enter a valid slug and join code."));
  redirect(
    `/temples/join/${encodeURIComponent(slug)}/${encodeURIComponent(joinPass)}`,
  );
}

/** The explicit confirmation POST; repeats converge on the existing membership. */
export async function joinTempleAction(formData: FormData) {
  const slug = field(formData, "slug");
  const joinPass = field(formData, "joinPass");
  if (!validRouteValue(slug) || !validRouteValue(joinPass))
    redirect(templeErrorPath("/temples", "Enter a valid slug and join code."));
  const callbackURL = `/temples/join/${encodeURIComponent(slug)}/${encodeURIComponent(joinPass)}`;
  if (!(await getCurrentSqlUserId())) redirect(signInPath(callbackURL));
  const writer = createSqlTempleWriter(db, getCurrentSqlUserId);
  const result = await writer.join({
    version: 1,
    expectedActorId: field(formData, "expectedActorId"),
    slug,
    joinPass,
  });
  if (!result.ok) redirect(templeErrorPath(callbackURL, result.message));
  redirect(
    `/temples?${new URLSearchParams({ joined: result.templeId }).toString()}`,
  );
}

export async function updateTempleInviteAction(formData: FormData) {
  const routeTempleId = field(formData, "templeId");
  if (!validRouteValue(routeTempleId)) redirect("/temples/admin");
  const callbackURL = `/temples/admin/${encodeURIComponent(routeTempleId)}`;
  if (!(await getCurrentSqlUserId())) redirect(signInPath(callbackURL));
  const result = await createSqlTempleWriter(
    db,
    getCurrentSqlUserId,
  ).updateInvite({
    version: 1,
    expectedActorId: field(formData, "expectedActorId"),
    templeId: routeTempleId,
    joinPass: field(formData, "joinPass"),
  });
  if (!result.ok) redirect(templeErrorPath(callbackURL, result.message));
  redirect(`/temples/admin/${result.templeId}`);
}

export async function updateTempleMembershipAction(formData: FormData) {
  const routeTempleId = field(formData, "templeId");
  const routeMembershipId = field(formData, "membershipId");
  if (!validRouteValue(routeTempleId) || !validRouteValue(routeMembershipId))
    redirect("/temples/admin");
  const callbackURL = `/temples/admin/${encodeURIComponent(routeTempleId)}/membership/${encodeURIComponent(routeMembershipId)}`;
  if (!(await getCurrentSqlUserId())) redirect(signInPath(callbackURL));
  const rawGrade = field(formData, "grade");
  const result = await createSqlTempleWriter(
    db,
    getCurrentSqlUserId,
  ).updateMembership({
    version: 1,
    expectedActorId: field(formData, "expectedActorId"),
    templeId: routeTempleId,
    membershipId: routeMembershipId,
    grade: rawGrade === "" ? Number.NaN : Number(rawGrade),
    admin: field(formData, "admin") === "true",
    motto: field(formData, "motto"),
    memberSince: field(formData, "memberSince") || null,
  });
  if (!result.ok) redirect(templeErrorPath(callbackURL, result.message));
  redirect(`/temples/admin/${result.templeId}`);
}
