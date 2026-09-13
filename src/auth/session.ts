import "server-only";
import { headers } from "next/headers";
import { sqlAuth } from "./runtime";
import { getFreshSqlSession, getFreshSqlUserId } from "./sqlAuth";

/** A fresh session read for each server action/page authorization boundary. */
export async function getCurrentSqlSession() {
  return getFreshSqlSession(sqlAuth, new Headers(await headers()));
}

/** Canonical identity only. Domain services must still load current grants. */
export async function getCurrentSqlUserId() {
  return getFreshSqlUserId(sqlAuth, new Headers(await headers()));
}
