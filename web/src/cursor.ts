import type { CursorSprite } from "thinking-orbs";

/** The macOS arrow, 28×40 pt, hotspot at the tip. Gravity stays off without a matching raster. */
const macArrow: CursorSprite = {
  src: "/cursors/arrow@2x.png",
  width: 28,
  height: 40,
  hotX: 5,
  hotY: 5,
};

export function orbGravity(): { sprite: CursorSprite } | undefined {
  if (typeof navigator === "undefined") return undefined;
  const mac = /Mac/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);
  return mac ? { sprite: macArrow } : undefined;
}
