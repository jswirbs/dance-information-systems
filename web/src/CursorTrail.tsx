import { useEffect, useRef } from "react";

const STAMP_MS = 40;
const LIFE_MS = 1000;
const HUE_STEP = 6;
const MOVE_PX = 2;
const CURSOR = [
  [0, 0],
  [0, 16],
  [4.2, 12.6],
  [7.4, 18.2],
  [9.6, 17],
  [6.3, 11.4],
  [11.4, 11.2],
] as const;
const CURSOR_PATH = `${CURSOR.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`).join(" ")} Z`;
const SWATCH_HUES = [0, 46, 92, 150, 205, 258, 312];

type Stamp = { x: number; y: number; born: number; hue: number };

function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  CURSOR.forEach(([px, py], index) => (index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function CursorTrailSwatch() {
  return (
    <span className="trail-swatch" aria-hidden="true">
      {SWATCH_HUES.map((hue, index) => (
        <svg
          key={hue}
          viewBox="0 0 12 19"
          style={{
            color: `hsl(${hue} 90% 58%)`,
            left: index * 5,
            opacity: 0.4 + (index / (SWATCH_HUES.length - 1)) * 0.6,
          }}
        >
          <path d={CURSOR_PATH} />
        </svg>
      ))}
    </span>
  );
}

export function CursorTrail({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!enabled || !canvas || !ctx) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;

    let hue = 0;
    let pointer: { x: number; y: number } | null = null;
    let last = { x: -1, y: -1, at: 0 };
    const stamps: Stamp[] = [];

    const resize = () => {
      const dpr = devicePixelRatio || 1;
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer = { x: event.clientX, y: event.clientY };
    };

    let frame = 0;
    const tick = (now: number) => {
      if (pointer && now - last.at >= STAMP_MS && Math.hypot(pointer.x - last.x, pointer.y - last.y) > MOVE_PX) {
        hue = (hue + HUE_STEP) % 360;
        stamps.push({ x: pointer.x, y: pointer.y, born: now, hue });
        last = { x: pointer.x, y: pointer.y, at: now };
      }

      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let write = 0;
      for (const stamp of stamps) {
        const age = now - stamp.born;
        if (age >= LIFE_MS) continue;
        stamps[write] = stamp;
        write += 1;
        drawCursor(ctx, stamp.x, stamp.y, `hsla(${stamp.hue} 90% 58% / ${1 - age / LIFE_MS})`);
      }
      stamps.length = write;
      frame = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("resize", resize);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("resize", resize);
    };
  }, [enabled]);

  if (!enabled) return null;
  return <canvas ref={ref} className="cursor-trail" aria-hidden="true" />;
}
