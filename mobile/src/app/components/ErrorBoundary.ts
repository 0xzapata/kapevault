import { Component, createElement, type ReactNode } from "react";

// The root's last line of defence: a render error anywhere below would otherwise unmount the whole React
// root and leave a blank screen. This shows one plain line and a button that reloads the page.
// It never keeps, shows or logs the error itself: its text could hold a secret (a password in a bad value).
// A .ts file with createElement, not a .tsx, so Node can load it for its test (npm test) without a JSX step.
interface Props {
  children?: ReactNode;
}
interface State {
  failed: boolean;
}

export const RECOVERY_TEXT = "Something went wrong. Close KAPEVault and open it again.";
export const RECOVERY_BUTTON = "Reload";

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  // Takes the error as an argument and drops it: only the fact of a failure is kept.
  static getDerivedStateFromError(_error: unknown): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return createElement(
      "div",
      { role: "alert", className: "grid min-h-[100dvh] place-items-center bg-canvas px-6 text-center" },
      createElement(
        "div",
        { className: "flex max-w-xs flex-col items-center gap-4" },
        createElement("p", { className: "text-[15px] text-ink" }, RECOVERY_TEXT),
        createElement(
          "button",
          { type: "button", className: "press hit h-11 rounded-full bg-accent px-5 text-[14px] font-semibold text-on-accent shadow-accent focus-ring", onClick: () => window.location.reload() },
          RECOVERY_BUTTON,
        ),
      ),
    );
  }
}
