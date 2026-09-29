import { useState } from "react";
import { useToast } from "@/components/Toast";
import { ipcMessage } from "@/lib/ipc-message";

// One button's call to main: busy while it runs (always cleared, even when it throws), then onDone
// with the result. A throw shows main's message in a toast, or goes to onError when the card shows
// its own error line. run() answers true when the action went through.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run<T>(action: () => Promise<T>, onDone?: (result: T) => void, onError?: (message: string) => void): Promise<boolean> {
    setBusy(true);
    try {
      const result = await action();
      onDone?.(result);
      return true;
    } catch (e) {
      if (onError) onError(ipcMessage(e));
      else toast(ipcMessage(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, run };
}
