import { plural } from "../../../lib/local-date.ts";
import type { EntryKind, Issue } from "../types";

// Months or years read better than "400 days" once a password is past a year old.
function age(days: number): string {
  if (days >= 730) return `${Math.floor(days / 365)} years`;
  const months = Math.floor(days / 30.4);
  return `${months} months`;
}

// Short line for the list row and the Security view.
export function issueLabel(issue: Issue): string {
  switch (issue.type) {
    case "reused":
      return `Reused on ${plural(issue.count, "other item")}`;
    case "weak":
      return "Weak password";
    case "old":
      return `Not changed in ${age(issue.days)}`;
    case "expired":
      return issue.days === 0 ? "Expired today" : `Expired ${plural(issue.days, "day")} ago`;
    case "expiring":
      return issue.days === 0 ? "Expires today" : `Expires in ${plural(issue.days, "day")}`;
    case "codes":
      return issue.left === 0 ? "No backup codes left" : `Only ${plural(issue.left, "backup code")} left`;
  }
}

const RENEW_ID = "Renew it where it was issued, then update the date here.";

// The longer explanation in the detail pane, with what to do about it. kind: an expiring thing is an
// ID (passport, license), renewed at the office that issued it, not a key made on a website.
export function issueAdvice(issue: Issue, kind: EntryKind): string {
  switch (issue.type) {
    case "reused":
      return "If one of these sites leaks, every account sharing this password is open. Give this one its own password.";
    case "weak":
      return "This password is easy to guess. Change it on the site, then save the new one here.";
    case "old":
      return "Passwords that never change stay useful to anyone who saw them. Rotate it when you next sign in.";
    case "expired":
      return kind === "thing" ? RENEW_ID : "Create a new key where this one was issued and save it here.";
    case "expiring":
      return kind === "thing" ? RENEW_ID : "Create a replacement before it stops working, then update this item.";
    case "codes":
      return issue.left === 0
        ? "Every saved code is used. Make new ones on the site while you can still sign in, then replace them here."
        : "Make new codes on the site before these run out, then replace them here.";
  }
}

// Serious first: a reused or weak password beats an old one.
export const ISSUE_ORDER: Issue["type"][] = ["reused", "weak", "expired", "codes", "expiring", "old"];
export const worstIssue = (issues: Issue[]) => [...issues].sort((a, b) => ISSUE_ORDER.indexOf(a.type) - ISSUE_ORDER.indexOf(b.type))[0];
