import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";

// Runs a copy, then shows the tick for a moment and confirms with a toast.
export function useCopyAction() {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  async function run(copy: () => Promise<unknown>, message: string) {
    try {
      await copy();
    } catch {
      toast("Could not copy", "error");
      return;
    }
    setCopied(true);
    toast(message);
  }

  return { copied, run };
}
