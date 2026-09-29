// The page's bridge to Android autofill (AutofillPlugin + KapeAutofillService in mobile/android/.../kapevault/).
// Another app's sign-in screen asks KAPEVault to fill it; the vault opens with the request waiting, the
// page shows a picker, and the chosen login's username and password go once to fill(). Off Android (the
// mock host in a browser) there is no autofill: every call answers as "not here".
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

// Who is asking. A browser's page is named by its site (webDomain and webScheme, trusted only from a
// browser, and only when every login field is in that one document); any other app by its name.
// addressBar: the page came from a compatibility-mode browser's address bar instead, which hides the scheme.
// username / password: which kinds of field the screen has. id: this request's, which fill() must name.
export interface FillTarget {
  id: string;
  packageName: string;
  appLabel: string;
  webDomain?: string;
  webScheme?: string; // "https", "http"; absent when the screen does not say: not https unless addressBar
  addressBar?: boolean;
  browser: boolean;
  username: boolean;
  password: boolean;
}

export interface AutofillStatus {
  supported: boolean; // this phone has autofill
  enabled: boolean; // KAPEVault is the phone's autofill service
}

interface AutofillPlugin {
  status(): Promise<AutofillStatus>;
  openSettings(): Promise<AutofillStatus>;
  disable(): Promise<AutofillStatus>;
  pending(): Promise<{ target?: FillTarget }>;
  fill(options: { id: string; username: string; password: string }): Promise<void>; // refused for any other id than the waiting request's
  cancel(): Promise<void>;
  addListener(event: "request", listener: (target: FillTarget) => void): Promise<PluginListenerHandle>;
  addListener(event: "ended", listener: () => void): Promise<PluginListenerHandle>;
}

const Autofill = registerPlugin<AutofillPlugin>("Autofill");
const here = Capacitor.isPluginAvailable("Autofill");
const OFF: AutofillStatus = { supported: false, enabled: false };

export const autofill = {
  status: () => (here ? Autofill.status() : Promise.resolve(OFF)),
  openSettings: () => (here ? Autofill.openSettings() : Promise.resolve(OFF)),
  disable: () => (here ? Autofill.disable() : Promise.resolve(OFF)),
  pending: async () => (here ? ((await Autofill.pending()).target ?? null) : null),
  fill: (target: FillTarget, username: string, password: string) => Autofill.fill({ id: target.id, username, password }),
  cancel: () => (here ? Autofill.cancel() : Promise.resolve()),
  // A request that comes in while the page is up, and the end of one (filled, cancelled, or the user went
  // back to the other app). Returns the unsubscribe.
  listen(onRequest: (target: FillTarget) => void, onEnded: () => void): () => void {
    if (!here) return () => {};
    const handles = [Autofill.addListener("request", onRequest), Autofill.addListener("ended", onEnded)];
    return () => handles.forEach((h) => void h.then((l) => l.remove()));
  },
};
