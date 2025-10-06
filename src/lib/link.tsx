"use client";
import MuiLink from "@mui/material/Link";
import NextLink from "next/link";
import React from "react";

export default function Link({
  href,
  children,
  underline,
}: {
  href: string;
  children: React.ReactNode;
  underline?: "none" | "hover" | "always";
}) {
  return (
    <MuiLink component={NextLink} href={href} underline={underline}>
      {children}
    </MuiLink>
  );
}
