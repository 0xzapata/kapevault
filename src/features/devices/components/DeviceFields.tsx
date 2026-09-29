import { useState, type ReactNode } from "react";
import { Scan } from "@phosphor-icons/react";
import { EyeButton, Label, TextInput } from "@/components/form";
import { MoreOptions } from "@/components/MoreOptions";
import { Segmented } from "@/components/Segmented";
import { isMac, keys } from "@/lib/platform";
import { plural } from "@/lib/local-date";
import { DEVICE_FIELDS, DEVICE_TYPES, FIELD_LABELS, FIRST_FIELDS, SECRET_FIELDS, type DeviceDraft, type DeviceField } from "../lib/devices";
import type { useDeviceForm } from "../hooks/use-device-form";
import { PhotoField } from "@/components/photo";

type DeviceForm = ReturnType<typeof useDeviceForm>;

interface DeviceFieldsProps {
  device: DeviceForm;
  titleRow: ReactNode; // the form's Title + Space, placed under the type
  startScan?: boolean; // opened from "Scan a label" on the item: pick a photo straight away
}

const PLACEHOLDERS: Partial<Record<DeviceField, string>> = {
  ssid: "As printed on the sticker",
  adminUrl: "192.168.1.1",
  adminUser: "admin",
  imei: "Dial *#06# to see it",
  mac: "AA:BB:CC:DD:EE:FF",
};
const MONO: DeviceField[] = ["serial", "imei", "mac"];

// Beside a field that still holds what the scan read, until the user changes it.
export function FromLabel({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="swap-in ml-1.5 inline-block rounded-full bg-accent-soft px-1.5 py-px align-[1px] text-[10.5px] font-semibold text-accent">from label</span>;
}

// The device part of the item form: the label photo and "Scan a label" first, then the type, then the
// fields that type needs. Everything else waits under "More details".
export function DeviceFields({ device, titleRow, startScan = false }: DeviceFieldsProps) {
  const { draft, set, fromLabel } = device;
  const [more, setMore] = useState(false);
  const [shown, setShown] = useState<Partial<Record<DeviceField, boolean>>>({});
  const first = FIRST_FIELDS[draft.type];
  const rest = DEVICE_FIELDS.filter((f) => !first.includes(f));
  const restFilled = rest.some((f) => draft[f]); // a detail already saved (or scanned) is never hidden

  function field(name: DeviceField) {
    const secret = SECRET_FIELDS.includes(name);
    const value = draft[name] ?? "";
    return (
      <div key={name} className={name === "adminUrl" ? "sm:col-span-2" : ""}>
        <Label text={FIELD_LABELS[name]} hint={<FromLabel show={fromLabel(name, value)} />}>
          <div className="relative">
            <TextInput
              type={secret && !shown[name] ? "password" : "text"}
              value={value}
              onChange={(e) => set({ [name]: e.target.value } as Partial<DeviceDraft>)}
              placeholder={PLACEHOLDERS[name]}
              inputMode={name === "imei" ? "numeric" : undefined}
              spellCheck={false}
              autoComplete="off"
              className={`${secret ? "pr-11 font-mono" : ""} ${MONO.includes(name) ? "font-mono" : ""}`}
            />
            {secret && (
              <EyeButton
                shown={Boolean(shown[name])}
                what={FIELD_LABELS[name]}
                onClick={() => setShown((s) => ({ ...s, [name]: !s[name] }))}
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
              />
            )}
          </div>
        </Label>
      </div>
    );
  }

  return (
    <>
      <LabelCard device={device} startScan={startScan} />

      <div>
        <span className="mb-1.5 block text-[12.5px] font-medium text-ink-2">
          Type
          <FromLabel show={fromLabel("type", draft.type)} />
        </span>
        <Segmented label="Type" options={DEVICE_TYPES} value={draft.type} onChange={(type) => set({ type })} className="grid-cols-5" />
      </div>

      {titleRow}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{first.map(field)}</div>

      <MoreOptions open={more || restFilled} onOpen={() => setMore(true)} label="More details" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rest.map(field)}
      </MoreOptions>
    </>
  );
}

// The photo area: "Scan a label" before there is a photo, a sheen while Windows reads it, then the
// photo with what the scan found.
function LabelCard({ device, startScan }: { device: DeviceForm; startScan: boolean }) {
  const { status, count } = device;
  const here = isMac ? "This Mac" : "This PC";
  const scanTile = (filled: boolean) => (
    <span className={`grid size-10 shrink-0 place-items-center rounded-[11px] ${filled ? "bg-accent text-on-accent shadow-accent" : "bg-accent-soft text-accent"}`}>
      <Scan size={20} weight="bold" />
    </span>
  );
  const [headline, line] =
    status === "found"
      ? [`Found ${plural(count, "detail")}`, "Check each one against the photo."]
      : status === "nothing"
        ? ["No details found", "Type them in below."]
        : status === "unavailable"
          ? ["Photo added", `${here} can't read text from photos. Type the details below.`]
          : ["Label photo", ""];

  return (
    <PhotoField
      label="Label photo"
      photo={device.photo}
      error={device.error}
      empty={{ icon: scanTile(true), title: "Scan a label", hint: `Pick a photo of the sticker, or paste one (${keys("mod", "V")})` }}
      heading={headline}
      line={line}
      pickAgain="Scan again"
      busy={
        status === "reading" ? (
          <div aria-live="polite" className="shimmer flex items-center gap-3.5 rounded-[14px] bg-field px-4 py-3.5">
            {scanTile(false)}
            <span className="text-[14px] font-semibold text-ink-2">Reading the label...</span>
          </div>
        ) : undefined
      }
      pickNow={startScan}
      onImage={device.read}
      onShow={device.showPhoto}
      onRemove={device.removePhoto}
    />
  );
}
