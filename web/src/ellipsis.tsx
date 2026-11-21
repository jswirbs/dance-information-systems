import { useEffect, useState } from "react";

const FRAMES = ["...", "..", ".", ".."];

/** Four-phase loop: "...", "..", ".", "..", then back to the full ellipsis. */
export function Ellipsis() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setFrame((current) => (current + 1) % FRAMES.length);
    }, 320);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="ellipsis" aria-hidden="true">
      {FRAMES[frame]}
    </span>
  );
}
