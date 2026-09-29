import { useEffect, useState } from "react";
import { ID_TYPES } from "@core";
import { useHost } from "../../host/host-context";
import type { DeviceType, Entry, EntryInput, EntryKind, GrabPriority, LinkType, SecretField, SignInMethod } from "../../host/types";

// The whole form as one draft, so switching kind on a new item keeps what was typed. A secret is null
// until the stored one has loaded (editing): saving while null keeps the stored one.
export interface Draft {
  kind: EntryKind;
  title: string;
  spaceId: string;
  notes: string;
  tags: string;
  heldFor: string;
  brand: string | undefined; // undefined = auto-detect, "none" = no logo, else a brand slug
  username: string;
  password: string | null;
  signIn: SignInMethod;
  viaEntryId: string;
  url: string;
  totp: string | undefined; // undefined = untouched, "" = remove
  body: string | null;
  keyId: string;
  secret: string | null;
  expires: string;
  linkType: LinkType;
  location: string;
  who: string;
  relation: string;
  provider: string;
  number: string;
  accountName: string;
  room: string;
  spot: string;
  grab: GrabPriority;
  type: DeviceType;
  model: string;
  serial: string;
  imei: string;
  mac: string;
  adminUrl: string;
  adminUser: string;
  adminPassword: string | null;
  ssid: string;
  wifiPassword: string | null;
  idType: string;
  idOther: boolean; // the ID's name is typed (Other), not picked from ID_TYPES
  idNumber: string | null;
  photo: string | null; // an ID's; null = saved, not loaded (Show photo), "" = none
}

export type SetDraft = <K extends keyof Draft>(field: K, value: Draft[K]) => void;

function draftFrom(e: Entry | null, spaceId: string, heldFor: string): Draft {
  const pick = <K extends EntryKind>(kind: K) => (e?.kind === kind ? (e as Extract<Entry, { kind: K }>) : null);
  const login = pick("login"), key = pick("key"), note = pick("note"), link = pick("link"), payee = pick("payee"), thing = pick("thing"), device = pick("device"), id = pick("id");
  // A payee saved untitled is "Who Provider", an ID its type: on edit the title keeps following them.
  const followsAuto = (payee && payee.title === `${payee.who} ${payee.provider}`) || (id && id.title === id.idType);
  return {
    kind: e?.kind ?? "login",
    title: followsAuto ? "" : (e?.title ?? ""),
    spaceId: e?.spaceId ?? spaceId,
    notes: e?.notes ?? "",
    tags: e?.tags.join(", ") ?? "",
    heldFor: e ? (e.heldFor ?? "") : heldFor,
    brand: e?.brand,
    username: login?.username ?? "",
    password: login?.hasPassword ? null : "",
    signIn: login?.signIn ?? "password",
    viaEntryId: login?.viaEntryId ?? "",
    url: login?.url ?? key?.url ?? "",
    totp: undefined,
    body: note?.hasBody ? null : "",
    keyId: key?.keyId ?? "",
    secret: key?.hasSecret ? null : "",
    expires: key?.expires ?? thing?.expires ?? "",
    linkType: link?.linkType ?? "web",
    location: link?.location ?? "",
    who: payee?.who ?? "",
    relation: payee?.relation ?? "",
    provider: payee?.provider ?? "",
    number: payee?.number ?? "",
    accountName: payee?.accountName ?? "",
    room: thing?.room ?? "",
    spot: thing?.spot ?? "",
    grab: thing?.grab ?? 2,
    type: device?.type ?? "router",
    model: device?.model ?? "",
    serial: device?.serial ?? "",
    imei: device?.imei ?? "",
    mac: device?.mac ?? "",
    adminUrl: device?.adminUrl ?? "",
    adminUser: device?.adminUser ?? "",
    adminPassword: device?.hasAdminPassword ? null : "",
    ssid: device?.ssid ?? "",
    wifiPassword: device?.hasWifiPassword ? null : "",
    idType: id?.idType ?? "",
    idOther: Boolean(id && !ID_TYPES.includes(id.idType)),
    idNumber: id?.hasNumber ? null : "",
    photo: id?.hasPhoto ? null : "",
  };
}

const orKeep = (v: string | null) => v ?? undefined;

export function useItemForm(entry: Entry | null, defaultSpaceId: string, defaultHeldFor = "") {
  const host = useHost();
  const [draft, setDraft] = useState(() => draftFrom(entry, defaultSpaceId, defaultHeldFor));
  const set: SetDraft = (field, value) => setDraft((d) => ({ ...d, [field]: value }));

  // Editing loads the stored secrets into their fields, each only if nothing was typed while it loaded.
  useEffect(() => {
    if (!entry) return;
    const load = (field: SecretField, into: "password" | "body" | "secret" | "adminPassword" | "wifiPassword" | "idNumber") =>
      host.getSecret(entry.id, field).then((v) => setDraft((d) => (d[into] === null ? { ...d, [into]: v } : d)), () => {});
    if (entry.kind === "login" && entry.hasPassword) load("password", "password");
    if (entry.kind === "note" && entry.hasBody) load("body", "body");
    if (entry.kind === "key" && entry.hasSecret) load("secret", "secret");
    if (entry.kind === "device" && entry.hasAdminPassword) load("adminPassword", "adminPassword");
    if (entry.kind === "device" && entry.hasWifiPassword) load("wifiPassword", "wifiPassword");
    if (entry.kind === "id" && entry.hasNumber) load("idNumber", "idNumber");
  }, [host, entry]);

  // An ID's photo is identity data: it loads only on Show photo, never with the secrets above.
  function showPhoto() {
    if (entry?.kind !== "id") return;
    host.getSecret(entry.id, "photo").then((photo) => setDraft((d) => (d.photo === null ? { ...d, photo } : d)), () => {});
  }

  const autoTitle = draft.kind === "id" ? draft.idType.trim() : [draft.who.trim(), draft.provider.trim()].filter(Boolean).join(" ");

  // What stops a save, in words, in the order the form reads; "" when it can be saved.
  function problem(): string {
    if (draft.kind === "payee") {
      if (!draft.who.trim()) return "Say who this payee is.";
      if (!draft.provider.trim()) return "Say which wallet or bank.";
      if (!draft.number.trim()) return "Add the account or mobile number.";
      return "";
    }
    if (draft.kind === "id") return autoTitle ? "" : draft.idOther ? "Say which ID it is." : "Pick which ID it is.";
    if (!draft.title.trim()) return "Give it a title.";
    if (draft.kind === "thing" && !draft.spot.trim()) return "Say where it is kept.";
    return "";
  }

  function input(): EntryInput {
    const d = draft;
    const base = {
      id: entry?.id,
      kind: d.kind,
      spaceId: d.spaceId,
      title: d.kind === "payee" || d.kind === "id" ? d.title.trim() || autoTitle : d.title,
      notes: d.kind === "note" ? "" : d.notes,
      tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
      favorite: entry?.favorite ?? false,
      heldFor: d.heldFor,
      brand: d.brand,
    };
    switch (d.kind) {
      case "login":
        return { ...base, username: d.username, password: orKeep(d.password), signIn: d.signIn, viaEntryId: d.viaEntryId || undefined, url: d.url, totp: d.totp };
      case "note":
        return { ...base, body: orKeep(d.body) };
      case "key":
        return { ...base, keyId: d.keyId, secret: orKeep(d.secret), url: d.url, expires: d.expires };
      case "link":
        return { ...base, linkType: d.linkType, location: d.location };
      case "payee":
        return { ...base, who: d.who, relation: d.relation, provider: d.provider, number: d.number, accountName: d.accountName };
      case "thing":
        return { ...base, room: d.room, spot: d.spot, grab: d.grab, expires: d.expires };
      case "device":
        return { ...base, type: d.type, model: d.model, serial: d.serial, imei: d.imei, mac: d.mac, adminUrl: d.adminUrl, adminUser: d.adminUser, adminPassword: orKeep(d.adminPassword), ssid: d.ssid, wifiPassword: orKeep(d.wifiPassword) };
      case "id":
        return { ...base, idType: d.idType, idNumber: orKeep(d.idNumber), photo: orKeep(d.photo) };
    }
  }

  return { draft, set, autoTitle, problem, input, showPhoto };
}
