import { Component, type ReactNode } from "react";

// One broken piece (a malformed file in a preview) shows its own message instead of unmounting the
// whole app - a blank window would sit there, unlocked, with no way back.
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
