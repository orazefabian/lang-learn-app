"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { rebuildDigest } from "./actions";

/** Builds this week from current data. Never sends anything. */
export function RebuildButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      className="self-start"
      onClick={() =>
        start(async () => {
          await rebuildDigest();
          router.refresh();
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? pendingLabel : label}
    </Button>
  );
}
