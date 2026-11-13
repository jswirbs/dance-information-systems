import type { EntityType, RelatedRow, SearchHit } from "../../src/shared/types";
import { ScrollList, Thumb } from "./ui";

const TARGETS: EntityType[] = ["artist", "label", "release"];

export function ExplorePanel({
  seeds,
  target,
  rows,
  error,
  onRemoveSeed,
  onTarget,
  onOpen,
}: {
  seeds: SearchHit[];
  target: EntityType;
  rows: RelatedRow[];
  error: string | null;
  onRemoveSeed: (seed: SearchHit) => void;
  onTarget: (target: EntityType) => void;
  onOpen: (type: EntityType, id: number) => void;
}) {
  return (
    <>
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
      <div className="toggle" role="tablist">
        {TARGETS.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={target === item} onClick={() => onTarget(item)}>
            related {item}s
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <ScrollList count={rows.length}>
        <ul className="rows">
          {rows.map((row) => (
            <li key={`${row.type}:${row.id}`}>
              <button type="button" onClick={() => onOpen(row.type, row.id)}>
                <Thumb url={row.thumbUrl} name={row.name} type={row.type} />
                <span>
                  <strong>
                    {row.name}
                    <em>{row.score}</em>
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
    </>
  );
}
