"use client";

import { useEffect } from "react";

/** On opening the lessons list, bring the learner's next lesson into view. */
export function ScrollToNext({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.scrollIntoView({ block: "center" });
  }, [targetId]);
  return null;
}
