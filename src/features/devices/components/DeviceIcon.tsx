import { Cpu, DeviceMobile, Laptop, SecurityCamera, WifiHigh, type Icon } from "@phosphor-icons/react";
import type { DeviceType } from "@/features/vault/types";

// One glyph per device type: the item tile, the type picker and the detail's Type row.
export const DEVICE_GLYPH: Record<DeviceType, Icon> = { router: WifiHigh, cctv: SecurityCamera, phone: DeviceMobile, laptop: Laptop, other: Cpu };
