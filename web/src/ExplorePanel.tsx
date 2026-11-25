import type { EntityType, RelatedRow, SearchHit } from "../../src/shared/types";
import { Ellipsis } from "./ellipsis";
import { HoverTip, useDelayedTip } from "./tooltip";
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

function ScoreMark({ value, note }: { value: number; note: string }) {
  const tip = useDelayedTip<HTMLElement>(Boolean(note));
  return (
    <em className="score" ref={tip.ref} onMouseEnter={tip.enter} onMouseLeave={tip.leave}>
      {formatScore(value)}
      {tip.tip && (
        <HoverTip tip={tip.tip}>
          <ScoreNote note={note} />
        </HoverTip>
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
