import { useToast } from "../../components/Toast";
import { useHost } from "../../host/host-context";

// Delete everywhere on the phone: the item goes to the Trash at once (no "are you sure"), and the toast
// carries Undo, which puts it back. Returns false when the host refused, after telling the user.
export function useMoveToTrash() {
  const host = useHost();
  const toast = useToast();
  return async (id: string): Promise<boolean> => {
    try {
      await host.deleteEntry(id);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Could not move it to the Trash", "error");
      return false;
    }
    toast("Moved to Trash", "ok", { label: "Undo", run: () => host.restoreEntry(id).catch(() => toast("Could not restore it", "error")) });
    return true;
  };
}
