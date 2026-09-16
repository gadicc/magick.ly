"use client";
import { Alert, Box, Button } from "@mui/material";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import React from "react";
import { ConfirmDialog } from "@/asyncConfirm";
import { sqlBrowserLifecycle } from "@/auth/browserLifecycle";
import { useSession } from "@/auth/client";
import { fenceLegacyNetworkForSql } from "@/db";
import serwistStuff from "@/serwistStuff";

type RecoveryState = "checking" | "ready" | "failed";

interface LegacyRecoveryContextValue {
  state: RecoveryState;
  retry(): void;
}

const LegacyRecoveryContext = React.createContext<LegacyRecoveryContextValue>({
  state: "checking",
  retry: () => {},
});

/** Account actions remain disabled until old browser data has a verified archive. */
export function useLegacyRecoveryGate() {
  return React.useContext(LegacyRecoveryContext);
}

function SqlIdentityBridge({ ready }: { ready: boolean }) {
  const session = useSession();
  const userId = session.data?.user.id ?? null;

  React.useEffect(() => {
    void userId;
    if (!ready || session.isPending) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden")
        void sqlBrowserLifecycle.refreshVerifiedAccount().catch(() => {});
    };
    refresh();
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ready, session.isPending, userId]);
  return null;
}

export default function ClientProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const [recoveryState, setRecoveryState] =
    React.useState<RecoveryState>("checking");
  const attempt = React.useRef(0);

  const recover = React.useCallback(() => {
    const current = ++attempt.current;
    setRecoveryState("checking");
    let recovery: ReturnType<typeof fenceLegacyNetworkForSql>;
    try {
      recovery = fenceLegacyNetworkForSql();
    } catch {
      if (current === attempt.current) setRecoveryState("failed");
      return;
    }
    void recovery.then(
      () => {
        if (current === attempt.current) setRecoveryState("ready");
      },
      () => {
        if (current === attempt.current) setRecoveryState("failed");
      },
    );
  }, []);

  React.useEffect(() => {
    recover();
    return serwistStuff();
  }, [recover]);

  const context = React.useMemo(
    () => ({ state: recoveryState, retry: recover }),
    [recover, recoveryState],
  );

  return (
    <LegacyRecoveryContext.Provider value={context}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        {children}
        <SqlIdentityBridge ready={recoveryState === "ready"} />
        {recoveryState !== "ready" && (
          <Box
            // Prerendered pages carry this status; keep it out of search snippets.
            data-nosnippet
            sx={{
              bottom: 12,
              left: 12,
              maxWidth: 560,
              position: "fixed",
              right: 12,
              zIndex: (theme) => theme.zIndex.snackbar,
            }}
          >
            <Alert
              severity={recoveryState === "failed" ? "error" : "info"}
              action={
                recoveryState === "failed" ? (
                  <Button color="inherit" onClick={recover} size="small">
                    Retry recovery
                  </Button>
                ) : undefined
              }
            >
              {recoveryState === "failed"
                ? "Old browser storage could not be verified. Public content and sign-out remain available, but sign-in stays locked until recovery succeeds."
                : "Checking this browser for offline work before allowing sign-in…"}
            </Alert>
          </Box>
        )}
        <ConfirmDialog />
      </LocalizationProvider>
    </LegacyRecoveryContext.Provider>
  );
}
