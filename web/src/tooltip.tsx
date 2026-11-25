import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export const TOOLTIP_DELAY = 800;

export type TipPlace = {
  top: number;
  left: number;
  above: boolean;
  /** `end` hangs the tip off the anchor's right edge. `start` grows from its left edge. */
  align: "start" | "end";
};

function placeTip(box: DOMRect): TipPlace {
  const above = window.innerHeight - box.bottom < 160 && box.top > 160;
  const align = box.right < 200 ? "start" : "end";
  return {
    top: Math.round(above ? box.top : box.bottom),
    left: Math.round(align === "start" ? box.left : box.right),
    above,
    align,
  };
}

function samePlace(a: TipPlace, b: TipPlace): boolean {
  return a.top === b.top && a.left === b.left && a.above === b.above && a.align === b.align;
}

export function useDelayedTip<T extends HTMLElement>(enabled: boolean, delay = TOOLTIP_DELAY) {
  const ref = useRef<T>(null);
  const timer = useRef<number | null>(null);
  const over = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const [tip, setTip] = useState<TipPlace | null>(null);
  const open = tip != null;

  const clear = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const hide = useCallback(() => {
    clear();
    setTip((current) => (current == null ? current : null));
  }, [clear]);

  const drop = useCallback(() => {
    over.current = false;
    hide();
  }, [hide]);

  const reveal = useCallback(() => {
    const anchor = ref.current;
    if (!anchor || !anchor.matches(":hover")) return;
    const next = placeTip(anchor.getBoundingClientRect());
    setTip((current) => (current && samePlace(current, next) ? current : next));
  }, []);

  const show = useCallback(() => {
    clear();
    if (!enabledRef.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (!enabledRef.current || !over.current) return;
      reveal();
    }, delay);
  }, [clear, delay, reveal]);

  const enter = useCallback(() => {
    over.current = true;
    show();
  }, [show]);

  const leave = useCallback(() => {
    drop();
  }, [drop]);

  useEffect(() => hide, [hide]);

  useEffect(() => {
    if (!enabled) {
      hide();
      return;
    }
    if (over.current) show();
  }, [enabled, hide, show]);

  // mouseenter and mouseleave are missed when the anchor moves out from under a still pointer.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const anchor = ref.current;
      if (!anchor) return;
      const inside = event.target instanceof Node && anchor.contains(event.target);
      if (inside) {
        if (!over.current) {
          over.current = true;
          show();
        }
        return;
      }
      if (over.current) drop();
    };
    window.addEventListener("pointermove", onPointer, true);
    return () => window.removeEventListener("pointermove", onPointer, true);
  }, [drop, show]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const tick = () => {
      const anchor = ref.current;
      if (!anchor || !anchor.matches(":hover")) {
        drop();
        return;
      }
      const next = placeTip(anchor.getBoundingClientRect());
      setTip((current) => (current && samePlace(current, next) ? current : next));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, drop]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open, hide]);

  return { ref, tip: enabled ? tip : null, enter, leave };
}

export function HoverTip({ tip, children }: { tip: TipPlace; children: ReactNode }) {
  return (
    <span className={`hover-tip ${tip.above ? "above" : "below"} align-${tip.align}`} role="tooltip" style={{ top: tip.top, left: tip.left }}>
      {children}
    </span>
  );
}
