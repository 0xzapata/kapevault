import { plural } from "@/lib/local-date";

// "Off", "1 hour", "8 hours": the Lock after choices, said the same way on the trust page and the lock screen.
export const hoursText = (hours: number) => (hours === 0 ? "Off" : plural(hours, "hour"));
