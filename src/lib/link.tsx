"use client";
import MuiLink, { type LinkProps as MuiLinkProps } from "@mui/material/Link";
import NextLink from "next/link";

// A server component can't pass NextLink to MuiLink across the client
// boundary, so this client wrapper does it and forwards everything else.
export type LinkProps = Omit<MuiLinkProps<typeof NextLink>, "component">;

export default function Link(props: LinkProps) {
  return <MuiLink component={NextLink} {...props} />;
}
