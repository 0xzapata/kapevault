// A main-process error reaches the page as "Error invoking remote method 'vault:save': Error: <message>".
const IPC_PREFIX = /^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/;

// Thrown by an IPC call (main's own words), not by page code.
export const isIpcError = (e: unknown): boolean => e instanceof Error && IPC_PREFIX.test(e.message);

// The message without Electron's wrapper: what main said, ready for a toast or an error line.
export const ipcMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(IPC_PREFIX, "").trim();
