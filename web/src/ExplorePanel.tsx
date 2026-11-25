import { useEffect, useRef, useState } from "react";
import type { EntityType, RelatedRow, SearchHit } from "../../src/shared/types";
import { Ellipsis } from "./ellipsis";
import { ScrollList, Thumb } from "./ui";

const TARGETS: EntityType[] = ["artist", "label", "release"];

export function ExplorePanel({
  seeds,
  target,
  rows,
  error,
  loading,
  onRemoveSeed,
  onTarget,
  onOpen,
}: {
  seeds: SearchHit[];
  target: EntityType;
  rows: RelatedRow[];
  error: string | null;
  loading: boolean;
  onRemoveSeed: (seed: SearchHit) => void;
  onTarget: (target: EntityType) => void;
  onOpen: (type: EntityType, id: number) => void;
}) {
  const showRelated = seeds.length > 0 || rows.length > 0;
  return (
    <>
      {seeds.length > 0 && (
        <div className="chips">
          {seeds.map((seed) => (
            <button
              key={`${seed.type}:${seed.id}`}
              type="button"
              className={`chip ${seed.type}`}
              onClick={() => onRemoveSeed(seed)}
            >
              {seed.name}
              <span aria-hidden="true"> ×</span>
            </button>
          ))}
        </div>
      )}
      {showRelated && (
        <>
          <hr className="path-rule" />
          <div className="toggle" role="tablist">
            {TARGETS.map((item) => (
              <button key={item} type="button" role="tab" aria-selected={target === item} onClick={() => onTarget(item)}>
                related {item}s
              </button>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          {loading && !error && (
            <p className="loading-note">
              Loading the neighborhood
              <Ellipsis />
            </p>
          )}
          {rows.length > 0 && (
            <ScrollList count={rows.length}>
              <ul className="rows related-rows">
                {rows.map((row) => (
                  <li key={`${row.type}:${row.id}`}>
                    <button type="button" onClick={() => onOpen(row.type, row.id)}>
                      <Thumb url={row.thumbUrl} name={row.name} type={row.type} />
                      <span className="row-copy">
                        <strong>
                          <span className="row-name">{row.name}</span>
                          {row.scoreNote && <ScoreMark value={row.score} note={row.scoreNote} />}
                        </strong>
                        <small>{row.reason}</small>
                        {row.type === "release" && (
                          <small className="meta">{[row.year, row.styles.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}</small>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollList>
          )}
        </>
      )}
    </>
  );
}

const SCORE_TIP_DELAY = 800;

function ScoreMark({ value, note }: { value: number; note: string }) {
  const ref = useRef<HTMLElement>(null);
  const timer = useRef<number | null>(null);
  const [tip, setTip] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const hide = () => {
    clear();
    setTip(null);
  };

  const show = () => {
    clear();
    if (!note) return;
    timer.current = window.setTimeout(() => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const above = window.innerHeight - box.bottom < 160 && box.top > 160;
      setTip({ top: above ? box.top : box.bottom, left: box.right, above });
    }, SCORE_TIP_DELAY);
  };

  useEffect(() => hide, []);

  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [tip]);

  return (
    <em className="score" ref={ref} onMouseEnter={show} onMouseLeave={hide}>
      {formatScore(value)}
      {tip && (
        <span className={`score-tip ${tip.above ? "above" : "below"}`} role="tooltip" style={{ top: tip.top, left: tip.left }}>
          <ScoreNote note={note} />
        </span>
      )}
    </em>
  );
}

function ScoreNote({ note }: { note: string }) {
  const split = note.indexOf("\n\n");
  if (split === -1) return note;
  return (
    <>
      {note.slice(0, split)}
      <span className="score-tip-math">{note.slice(split + 2)}</span>
    </>
  );
}

function formatScore(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
