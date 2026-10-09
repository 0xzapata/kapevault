import "./stub";
import "@/index.css";
import { createRoot } from "react-dom/client";
import { BRANDS, detectBrand } from "@/features/brands/brands";
import { EntryForm } from "@/features/vault/components/EntryForm";
import type { Entry } from "@/features/vault/types";
import { ToastProvider } from "@/components/Toast";
import { FormsFixture, MoveFixture } from "./forms-fixture";
import { ModalFixture, ReturnFixture } from "./modal-fixture";

const scenario = new URLSearchParams(location.search).get("s") ?? "new";
const common = { spaceId: "p", tags: [], favorite: false, notes: "", updatedAt: "2026-09-25", issues: [] };
const ENTRIES: Record<string, Entry | null> = {
  new: null,
  login: { ...common, id: "l1", kind: "login", title: "GitHub", username: "me@example.com", hasPassword: true, hasTotp: true, history: [], signIn: "password", url: "https://github.com" },
  locked: { ...common, id: "locked", kind: "login", title: "GitHub", username: "me@example.com", hasPassword: true, hasTotp: false, history: [], signIn: "password", url: "" }, // the vault locks while it loads
  note: { ...common, id: "n1", kind: "note", title: "Recovery codes", hasBody: true },
  key: { ...common, id: "k1", kind: "key", title: "Stripe", keyId: "pk_live_123", hasSecret: true, url: "https://stripe.com", expires: "2027-01-01" },
};

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("the harness page has no #root");
const root = createRoot(rootEl);
if (scenario === "modal") root.render(<ToastProvider><ModalFixture /></ToastProvider>);
else if (scenario === "return") root.render(<ReturnFixture />);
else if (scenario === "forms") root.render(<ToastProvider><FormsFixture /></ToastProvider>);
else if (scenario === "move") root.render(<ToastProvider><MoveFixture /></ToastProvider>);
// BRANDS is built with Vite's import.meta.glob, which Node cannot run, so its contents are read here.
else if (scenario === "brands") root.render(<pre id="brands">{JSON.stringify({ brands: BRANDS.map((b) => [b.slug, Boolean(b.logo)]), landbank: detectBrand("https://www.landbank.com", "")?.slug ?? null })}</pre>);
else root.render(
  <div style={{ height: "100dvh", background: "white" }}>
    {/* The app behind the sheet: the sheet must make it inert. */}
    <button type="button" data-behind>Behind</button>
    <EntryForm
      entry={ENTRIES[scenario]}
      entries={[]}
      spaces={[{ id: "p", name: "Personal", kind: "personal" }]}
      defaultSpaceId="p"
      onSave={async (input) => {
        await new Promise((r) => setTimeout(r, 400));
        if (input.title === "bad") throw new Error("Error invoking remote method 'vault:saveEntry': Error: That is not a valid 2FA setup key.");
        if (input.title === "locked") throw new Error("Error invoking remote method 'vault:saveEntry': Error: Vault is locked");
        (window as any).__saved.push(input);
      }}
      onDelete={async () => {}}
      onClose={() => ((window as any).__closed = true)}
    />
  </div>,
);
