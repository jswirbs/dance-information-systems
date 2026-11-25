import { BlockedIcon, PauseIcon, PlayIcon } from "./PathPlayer";
import { Ellipsis } from "./ellipsis";
import { HoverTip, useDelayedTip } from "./tooltip";

export function PlayToggle({
  paused,
  busy = false,
  error = null,
  retry = true,
  name = "",
  className,
  onToggle,
}: {
  paused: boolean;
  busy?: boolean;
  error?: string | null;
  /** A blocked button can still be clicked when a retry might succeed. */
  retry?: boolean;
  name?: string;
  className?: string;
  onToggle: () => void;
}) {
  const blocked = error != null && !busy;
  const tip = useDelayedTip<HTMLSpanElement>(blocked);
  const action = paused ? "Play" : "Pause";
  const label = busy ? "Finding video" : blocked && error ? error : name ? `${action} ${name}` : action;
  return (
    <span className={`play-toggle-wrap${className ? ` ${className}` : ""}`} ref={tip.ref} onMouseEnter={tip.enter} onMouseLeave={tip.leave}>
      <button
        type="button"
        className={`play-toggle${blocked ? " is-blocked" : ""}${blocked && !retry ? " is-static" : ""}`}
        aria-label={label ?? undefined}
        aria-disabled={blocked && !retry ? true : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (busy || (blocked && !retry)) return;
          onToggle();
        }}
      >
        {busy ? <Ellipsis /> : blocked ? <BlockedIcon /> : paused ? <PlayIcon /> : <PauseIcon />}
      </button>
      {tip.tip && error ? <HoverTip tip={tip.tip}>{error}</HoverTip> : null}
    </span>
  );
}
