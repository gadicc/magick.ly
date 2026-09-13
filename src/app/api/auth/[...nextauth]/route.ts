import { toNextJsHandler } from "better-auth/next-js";
import { guardSqlAuthHandler } from "@/auth/cutoverReadiness";
import { sqlAuth } from "@/auth/runtime";

export const runtime = "nodejs";
const handlers = toNextJsHandler(sqlAuth);
export const GET = guardSqlAuthHandler(handlers.GET);
export const POST = guardSqlAuthHandler(handlers.POST);
