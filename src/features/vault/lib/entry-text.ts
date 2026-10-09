import { signInOption, usesPassword } from "./sign-in.ts";
import { isGone } from "../../closing/lib/lifecycle.ts";
import { deviceName, deviceSubtitle } from "../../devices/lib/devices.ts";
import { idSubtitle } from "../../ids/lib/ids.ts";
import { formatDay } from "../../../lib/local-date.ts";
import type { Entry } from "../types";

// A list row's second line: the username, a link's location.
// orUrl: a password login with no username shows its website instead (quick search's rows; the
// main list leaves the line empty).
export function entrySubtitle(entry: Entry, { orUrl = false } = {}): string {
  switch (entry.kind) {
    case "link":
      return entry.location;
    case "note":
      return "Secure note";
    case "key":
      return entry.keyId || "API key";
    case "thing":
      return entry.room ? `${entry.room} · ${entry.spot}` : entry.spot;
    case "device":
      return deviceSubtitle(entry);
    case "id":
      return idSubtitle(entry);
    default: {
      if (entry.lifecycle?.goneAt) return `Closed ${formatDay(entry.lifecycle.goneAt)}`; // only the main list shows a closed account
      if (usesPassword(entry.signIn)) return orUrl ? entry.username || entry.url : entry.username;
      const via = `${signInOption(entry.signIn).label} sign-in`;
      return entry.username ? `${via} - ${entry.username}` : via;
    }
  }
}

const LINK_LABELS = { web: "Web link", drive: "Google Drive", folder: "Local folder", doc: "Document" };

// What an item is, under its title in the detail pane: "Login", "Google sign-in", "Router".
export function kindLabel(entry: Entry): string {
  switch (entry.kind) {
    case "login":
      if (isGone(entry)) return "Closed account";
      return usesPassword(entry.signIn) ? "Login" : `${signInOption(entry.signIn).label} sign-in`;
    case "note":
      return "Secure note";
    case "key":
      return "API key";
    case "link":
      return LINK_LABELS[entry.linkType];
    case "thing":
      return "Thing";
    case "device":
      return deviceName(entry.type);
    case "id":
      return "ID";
  }
}
