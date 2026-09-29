import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { vaultApi } from "@/lib/vault-api";
import { isMac } from "@/lib/platform";

// The window is frameless: each pane draws its own slice of the title bar (a drag region), and the
// OS draws its window controls over it - Windows' caption buttons top-right (about 138px), macOS'
// traffic lights top-left. Whichever pane touches that corner leaves room for them.
const WindowState = createContext({ fullScreen: false });

export function WindowStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ fullScreen: false });
  useEffect(() => vaultApi.onWindowState((s) => setState({ fullScreen: s.fullScreen })), []);
  return <WindowState.Provider value={state}>{children}</WindowState.Provider>;
}

interface TitleBarProps {
  edgeLeft?: boolean; // this bar starts at the window's left edge
  edgeRight?: boolean; // this bar ends at the window's right edge
  className?: string;
  children?: ReactNode;
}

export function TitleBar({ edgeLeft = false, edgeRight = false, className = "", children }: TitleBarProps) {
  const { fullScreen } = useContext(WindowState);
  const left = isMac && edgeLeft && !fullScreen ? "pl-[84px]" : "";
  const right = !isMac && edgeRight ? "pr-[150px]" : "";
  return <div className={`drag flex h-[52px] shrink-0 items-center ${left} ${right} ${className}`}>{children}</div>;
}
