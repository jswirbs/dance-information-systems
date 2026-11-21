import type { SearchHit } from "../../src/shared/types";
import { Thumb } from "./ui";

export function SearchSuggest({ hits, onPick }: { hits: SearchHit[]; onPick: (hit: SearchHit) => void }) {
  if (hits.length === 0) {
    return (
      <div className="search-suggest search-suggest-empty" role="status">
        No results found
      </div>
    );
  }
  return (
    <ul className="search-suggest" role="listbox">
      {hits.map((hit) => (
        <li key={`${hit.type}:${hit.id}`}>
          <button
            type="button"
            role="option"
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(hit);
            }}
          >
            <Thumb url={hit.thumbUrl} name={hit.name} type={hit.type} />
            <span>
              <strong>{hit.name}</strong>
              <small>
                {hit.type}
                {hit.disambiguator ? ` · ${hit.disambiguator}` : ""}
              </small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
