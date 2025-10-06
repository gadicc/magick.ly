"use client";
import { createTRPCClient, unstable_httpBatchStreamLink } from "@trpc/client";
//     👆 **type-only** import
import superjson from "superjson";
import type { AppRouter } from "@/app/api/trpc/appRouter";

const origin =
  typeof window === "undefined"
    ? "http://localhost:3000"
    : window.location.origin;

// Pass AppRouter as generic here. 👇 This lets the `trpc` object know
// what procedures are available on the server and their input/output types.
const trpc = createTRPCClient<AppRouter>({
  links: [
    unstable_httpBatchStreamLink({
      url: origin + "/api/trpc",
      transformer: superjson,
    }),
  ],
});

export default trpc;
