// D:\Clients\..., \\server\share, or /Users/... on a Mac
export const isLocalPath = (location: string) => /^[a-zA-Z]:[\\/]|^\\\\|^\//.test(location);

// Listing a network folder contacts that server, so it waits for a click instead of opening on select.
export const isNetworkPath = (location: string) => /^[\\/]{2}/.test(location);
