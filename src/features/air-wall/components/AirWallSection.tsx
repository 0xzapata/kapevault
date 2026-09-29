import { GlobeSimple, ShieldCheck, Wall, WarningCircle } from "@phosphor-icons/react";
import { Button, ErrorText } from "@/components/form";
import { Group, SwitchRow } from "@/features/settings/SettingRow";
import { DEVICE } from "@/lib/platform";
import type { AirWallStatus, AirWallTest } from "@/lib/vault-api";
import { useAirWall } from "../hooks/use-air-wall";

const TITLE = "Keep KAPEVault offline";
const UNAVAILABLE = {
  unpacked: "Works only in the installed app.",
  platform: "Windows only for now.",
};

function testLine(result: AirWallTest, on: boolean) {
  if (result === "blocked") return { text: "Windows blocked it.", tone: "text-ok" };
  if (result === "open" && on) return { text: "It got through. Turn on Windows Firewall.", tone: "text-danger" };
  if (result === "open") return { text: "It got through.", tone: "text-ink-3" };
  return { text: `No answer. Is this ${DEVICE} online?`, tone: "text-ink-3" };
}

// Rule state plus the Test button, in the same tile style as Cloud backup.
function StatusTile({ status, tested, testing, disabled, onTest }: { status: Extract<AirWallStatus, { available: true }>; tested: AirWallTest | null; testing: boolean; disabled: boolean; onTest: () => void }) {
  const on = status.state === "on" || status.state === "unenforced";
  let title = "Not blocked";
  let icon = <GlobeSimple size={22} weight="duotone" className="text-ink-3" />;
  let sub: { text: string; tone: string } | null = null;
  if (status.state === "on") {
    title = "Blocked by Windows";
    icon = <ShieldCheck size={22} weight="duotone" className="text-ok" />;
  }
  if (status.state === "unenforced") {
    title = "Windows Firewall is off";
    icon = <WarningCircle size={22} weight="duotone" className="text-warn" />;
    sub = { text: "Turn it on in Windows Security to block this app.", tone: "text-ink-3" };
  }
  if (status.state === "other") {
    title = "Set for another copy of KAPEVault";
    icon = <WarningCircle size={22} weight="duotone" className="text-warn" />;
    sub = { text: `${status.program} - turn on to use this copy.`, tone: "text-ink-3" };
  }
  if (tested) sub = testLine(tested, on);
  if (testing) sub = { text: "Testing...", tone: "text-ink-3" };

  return (
    // min-h: a test answer adds a line without the tile jumping
    <div className="flex min-h-[62px] items-center gap-3 rounded-[12px] bg-field px-3.5 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">{title}</p>
        {sub && (
          <p role="status" className={`break-words text-[12.5px] ${sub.tone}`}>
            {sub.text}
          </p>
        )}
      </div>
      <Button type="button" className="h-8 bg-raised" disabled={disabled} onClick={onTest}>
        Test
      </Button>
    </div>
  );
}

// Settings > Security: Air Wall, a Windows Firewall rule that keeps KAPEVault itself offline.
export function AirWallSection() {
  const wall = useAirWall();
  const status = wall.status;

  let note = "Windows Firewall stops this app from going online. Cloud backup still works. Windows asks for permission each time.";
  if (status && !status.available) note = UNAVAILABLE[status.reason];
  if (wall.busy === "switch") note = "Waiting for Windows...";

  return (
    <Group title="Network">
      <SwitchRow
        title={TITLE}
        icon={<Wall size={20} weight="duotone" />}
        checked={status?.available === true && (status.state === "on" || status.state === "unenforced")}
        disabled={wall.busy !== null || !status?.available}
        onChange={wall.toggle}
        note={note}
      />
      {status?.available && <StatusTile status={status} tested={wall.tested} testing={wall.busy === "test"} disabled={wall.busy !== null} onTest={wall.test} />}
      <ErrorText message={wall.error} />
    </Group>
  );
}
