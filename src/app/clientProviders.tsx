"use client";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { SessionProvider } from "next-auth/react";
import React from "react";
import { ConfirmDialog } from "@/asyncConfirm";
import serwistStuff from "@/serwistStuff";

export default function ClientProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    // serwistStuff() setups up and returns a cleanup function
    return serwistStuff();
  }, []);

  return (
    <SessionProvider>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        {children}
        <ConfirmDialog />
      </LocalizationProvider>
    </SessionProvider>
  );
}
