import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/app.css";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import { HostProvider } from "./host/host-context";
import { createMockHost } from "./host/mock-host";
import { nativeDeps } from "./host/native";
import { createRealHost } from "./host/real-host";
import { SettingsProvider } from "./features/settings/settings-context";
import { installSprings } from "./lib/spring";

// The real vault host. ?mock (dev builds only; a release build drops it) runs the UI on the mock host.
const host = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock") ? createMockHost() : createRealHost(nativeDeps());
installSprings();

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <HostProvider host={host}>
        <SettingsProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </SettingsProvider>
      </HostProvider>
    </React.StrictMode>,
  );
}
