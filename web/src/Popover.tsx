import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";

export function Popover({
  open,
  onClose,
  anchorRef,
  className,
  style,
  role = "dialog",
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
  style?: CSSProperties;
  role?: "dialog" | "menu";
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    // Capture: d3-zoom stops mousedown on the graph canvas before it bubbles.
    document.addEventListener("mousedown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return (
    <div ref={panelRef} className={`popover ${className ?? ""}`} style={style} role={role}>
      {children}
    </div>
  );
}
