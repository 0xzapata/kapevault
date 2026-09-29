import { SystemBars, SystemBarsStyle } from "@capacitor/core";

// The page draws behind Android's status and navigation bars (edge to edge), so their icons follow the
// page's theme, not the phone's: light icons on the dark theme, dark icons on the light ones.
export function setSystemBarIcons(darkPage: boolean) {
  void SystemBars.setStyle({ style: darkPage ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}
