"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { pendingCount } from "@/lib/offline/store";
import { refreshBundle, syncPending } from "@/lib/offline/sync-client";

/**
 * Registers the service worker, watches the connection, and drains the queue.
 *
 * One place for all of it so the review screen can ask "are we online, is
 * anything waiting" without every component growing its own listeners.
 */

type OfflineState = {
  online: boolean;
  /** Answers and recordings waiting to go back to the server. */
  queued: number;
  syncing: boolean;
  refreshQueue: () => void;
};

const OfflineContext = createContext<OfflineState>({
  online: true,
  queued: 0,
  syncing: false,
  refreshQueue: () => {},
});

export const useOffline = () => useContext(OfflineContext);

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshQueue = useCallback(() => {
    void pendingCount().then(setQueued);
  }, []);

  useEffect(() => {
    // Starts true on the server; the browser is the authority.
    setOnline(navigator.onLine);
    refreshQueue();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // No worker means no offline mode. Everything else still works.
      });
    }
  }, [refreshQueue]);

  const drain = useCallback(async () => {
    setSyncing(true);
    try {
      await syncPending();
      // Fetching the next bundle while she is online is what makes the next
      // offline session possible at all.
      await refreshBundle();
    } finally {
      setSyncing(false);
      refreshQueue();
    }
  }, [refreshQueue]);

  useEffect(() => {
    function goOnline() {
      setOnline(true);
      void drain();
    }
    function goOffline() {
      setOnline(false);
    }

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [drain]);

  useEffect(() => {
    if (!online) return;
    // On load too, not only on the online event: the tab may have been killed
    // offline and reopened with a connection, which fires no event at all.
    const timer = setTimeout(() => void drain(), 1_500);
    return () => clearTimeout(timer);
  }, [drain, online]);

  return (
    <OfflineContext.Provider value={{ online, queued, syncing, refreshQueue }}>
      {children}
    </OfflineContext.Provider>
  );
}
