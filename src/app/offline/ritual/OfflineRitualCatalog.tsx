"use client";

import Link from "@magick-components/Link";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import React from "react";
import { getBrowserOfflineRuntime } from "@/offline/browserRuntime";
import type { OfflineAccount } from "@/offline/lease";
import type { OfflineOperation } from "@/offline/lifecycle";

type Item = Readonly<{ id: string; title: string }>;

/** Titles enter the DOM only through lifecycle-gated bundle reads. */
export default function OfflineRitualCatalog() {
  const [items, setItems] = React.useState<Item[]>([]);
  const [status, setStatus] = React.useState<
    "loading" | "ready" | "locked" | "unavailable"
  >("loading");
  React.useEffect(() => {
    let disposed = false;
    let runtime: ReturnType<typeof getBrowserOfflineRuntime>;
    try {
      runtime = getBrowserOfflineRuntime();
    } catch {
      setStatus("unavailable");
      return;
    }
    let sequence = 0;
    let accountKey: string | null | undefined;
    const registrations = new Map<
      string,
      ReturnType<typeof runtime.coordinator.register>
    >();

    const clear = () => {
      for (const registration of registrations.values()) registration.dispose();
      registrations.clear();
      setItems([]);
    };
    const load = async (
      account: OfflineAccount,
      ritualId: string,
      operation: OfflineOperation,
    ) => {
      try {
        const bundle = await runtime.repository.readBundle(account, ritualId);
        if (!bundle || operation.signal.aborted) return;
        runtime.coordinator.commit(operation, () => {
          if (disposed) return;
          setItems((current) =>
            [
              ...current.filter((item) => item.id !== ritualId),
              {
                id: ritualId,
                title: bundle.title,
              },
            ].sort((a, b) => a.title.localeCompare(b.title)),
          );
          setStatus("ready");
        });
      } catch {
        if (!disposed) setStatus("unavailable");
      } finally {
        runtime.coordinator.finish(operation);
      }
    };
    const discover = async (account: OfflineAccount) => {
      const currentSequence = ++sequence;
      clear();
      setStatus("loading");
      try {
        const ids = await runtime.repository.listDownloadedRitualIds(account);
        if (disposed || currentSequence !== sequence) return;
        if (ids.length === 0) setStatus("ready");
        for (const ritualId of ids) {
          let registration: ReturnType<typeof runtime.coordinator.register>;
          registration = runtime.coordinator.register({
            ritualId,
            capability: "read",
            hide: () => {
              if (disposed) return;
              setItems((current) =>
                current.filter((item) => item.id !== ritualId),
              );
              setStatus("locked");
            },
            available: () => {
              const operation = registration.begin();
              if (operation) void load(account, ritualId, operation);
            },
          });
          registrations.set(ritualId, registration);
        }
      } catch {
        if (!disposed && currentSequence === sequence) setStatus("unavailable");
      }
    };

    const unsubscribe = runtime.subscribeState((state) => {
      const nextKey = state.account
        ? `${state.account.ownerId}:${state.account.epoch}`
        : null;
      if (nextKey === accountKey) return;
      accountKey = nextKey;
      sequence++;
      if (!state.account) {
        clear();
        setStatus("locked");
      } else void discover(state.account);
    });
    void runtime.start().catch(() => {
      if (!disposed) setStatus("unavailable");
    });
    return () => {
      disposed = true;
      sequence++;
      unsubscribe();
      for (const registration of registrations.values()) registration.dispose();
      registrations.clear();
    };
  }, []);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" component="h1" sx={{ mb: 2 }}>
        Downloaded rituals
      </Typography>
      {status === "loading" && (
        <CircularProgress aria-label="Loading downloaded rituals" />
      )}
      {status === "unavailable" && (
        <Alert severity="info">
          Downloaded rituals are unavailable on this device.
        </Alert>
      )}
      {status === "locked" && items.length === 0 && (
        <Alert severity="info">
          No verified offline account is active. Open a downloaded ritual once
          while signed in and online.
        </Alert>
      )}
      {status === "ready" && items.length === 0 && (
        <Alert severity="info">No unexpired ritual downloads were found.</Alert>
      )}
      {items.length > 0 && (
        <List aria-label="Downloaded rituals">
          {items.map((item) => (
            <ListItem key={item.id} disablePadding>
              <ListItemText
                primary={<Link href={`/doc/${item.id}`}>{item.title}</Link>}
              />
            </ListItem>
          ))}
        </List>
      )}
      <Button sx={{ mt: 2 }} onClick={() => window.location.reload()}>
        Retry
      </Button>
    </Box>
  );
}
