"use client";
import React from "react";
import { SessionProvider } from "next-auth/react";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import serwistStuff from "@/serwistStuff";
import { ConfirmDialog } from "@/asyncConfirm";

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
