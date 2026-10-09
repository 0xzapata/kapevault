import type { Entry } from "../types";

// How long an item in the Trash has left, in words a person reads at a glance. 0 means the last
// hours: the next save or unlock lets go of it.
export function daysLeftLabel(days: number): string {
  if (days <= 0) return "Going today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

// The line under a Trash row and the line in its detail. The days come with the item: main counts them
// against the vault's sync stamps, which the page never sees. Without them it says nothing rather than guess.
export function trashLine(entry: Entry): string {
  return entry.daysLeft === undefined ? "" : daysLeftLabel(entry.daysLeft);
}
