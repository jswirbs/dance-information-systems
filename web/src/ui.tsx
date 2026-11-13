import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AliasRef, EntityDetail, EntityType } from "../../src/shared/types";

export function ScrollList({ count, children }: { count: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const hasMore = useHasMore(ref, count);
  return (
    <div className={`rows-scroll${hasMore ? " has-more" : ""}`}>
      <div className="rows-scroll-body" ref={ref}>
        {children}
      </div>
      {hasMore && (
        <div className="rows-more" aria-hidden="true">
          ↓
        </div>
      )}
    </div>
  );
}

function useHasMore(ref: RefObject<HTMLElement | null>, itemCount: number) {
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref, itemCount]);
  return hasMore;
}

export function NameButtons({ items, onPick }: { items: { key: string; id: number; label: string }[]; onPick: (id: number) => void }) {
  return items.map((item, index) => (
    <Fragment key={item.key}>
      {index > 0 ? " " : null}
      <span className="name-with-comma">
        <button type="button" className="text-button" onClick={() => onPick(item.id)}>
          {item.label}
        </button>
        {index < items.length - 1 ? "," : null}
      </span>
    </Fragment>
  ));
}

function AliasList({ aliases, onPick }: { aliases: AliasRef[]; onPick: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (expanded) return;
    const root = measureRef.current;
    if (!root) return;
    const apply = () => {
      const next = aliasLimit(root);
      setLimit((current) => (current === next ? current : next));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(root);
    return () => observer.disconnect();
  }, [aliases, expanded]);

  const shown = expanded || limit == null ? aliases : aliases.slice(0, limit);
  const hidden = aliases.length - shown.length;

  return (
    <div className="aka-wrap">
      {!expanded && (
        <div className="aka aka-measure" ref={measureRef} aria-hidden="true">
          {"Also known as "}
          {aliases.map((alias, index) => (
            <Fragment key={alias.id}>
              {index > 0 ? " " : null}
              <span className="name-with-comma" data-alias="">
                <span className="text-button">{alias.name}</span>
                {index < aliases.length - 1 ? "," : null}
              </span>
            </Fragment>
          ))}
          <span className="more-probe" data-more-probe="" />
        </div>
      )}
      <div className="aka">
        {"Also known as "}
        {shown.map((alias, index) => (
          <Fragment key={alias.id}>
            {index > 0 ? " " : null}
            <span className="name-with-comma">
              <button type="button" className="text-button" onClick={() => onPick(alias.id)}>
                {alias.name}
              </button>
              {index < shown.length - 1 || hidden > 0 ? "," : null}
            </span>
          </Fragment>
        ))}
        {hidden > 0 && (
          <>
            {" "}
            <button type="button" className="text-button" onClick={() => setExpanded(true)}>
              {`& ${hidden} more`}
            </button>
          </>
        )}
        {expanded && limit != null && limit < aliases.length && (
          <button type="button" className="text-button alias-collapse" onClick={() => setExpanded(false)}>
            collapse
          </button>
        )}
      </div>
    </div>
  );
}

function aliasLimit(root: HTMLElement): number {
  const tokens = [...root.querySelectorAll<HTMLElement>("[data-alias]")];
  const total = tokens.length;
  if (total === 0) return 0;
  const tops = lineTops(tokens);
  if (tops.length <= 2) return total;

  const line2 = tops[1];
  const probe = root.querySelector<HTMLElement>("[data-more-probe]");
  if (!probe) return total;
  const right = root.getBoundingClientRect().right;
  let count = tokens.filter((token) => token.getBoundingClientRect().top <= line2 + 2).length;

  const fits = (n: number) => {
    const hidden = total - n;
    if (hidden <= 0) return true;
    const last = tokens[n - 1];
    if (!last) return false;
    const top = last.getBoundingClientRect().top;
    if (top > line2 + 2) return false;
    if (top < line2 - 2) return true;
    probe.textContent = ` & ${hidden} more`;
    return last.getBoundingClientRect().right + probe.offsetWidth <= right + 1;
  };

  while (count > 0 && !fits(count)) count -= 1;
  return Math.max(count, 1);
}

function lineTops(tokens: HTMLElement[]): number[] {
  const tops: number[] = [];
  for (const token of tokens) {
    const top = token.getBoundingClientRect().top;
    if (!tops.some((line) => Math.abs(line - top) < 2)) tops.push(top);
  }
  tops.sort((a, b) => a - b);
  return tops;
}

function discogsHref(type: EntityType, id: number): string {
  return `https://www.discogs.com/${type}/${id}`;
}

export function Thumb({ url, name, type }: { url: string | null; name: string; type: EntityType }) {
  if (url) return <img className="thumb" src={url} alt="" />;
  return <span className={`thumb placeholder ${type}`}>{name.slice(0, 1)}</span>;
}

export function Detail({
  record,
  useLabel,
  onUse,
  onOpen,
}: {
  record: EntityDetail;
  useLabel: string | null;
  onUse: () => void;
  onOpen: (type: EntityType, id: number) => void;
}) {
  const blurb = record.profile || record.notes;
  const image = record.imageUrl || record.thumbUrl;
  return (
    <article className="detail">
      <div className="detail-head">
        {image ? <img src={image} alt="" /> : <span className={`thumb placeholder large ${record.type}`}>{record.name.slice(0, 1)}</span>}
        <div className="detail-copy">
          <p className="eyebrow">{record.type}</p>
          <h2>{record.name}</h2>
          {record.realname && <p>{record.realname}</p>}
          {record.aliases.length > 0 && (
            <AliasList key={`${record.type}:${record.id}`} aliases={record.aliases} onPick={(id) => onOpen("artist", id)} />
          )}
          {record.labels.length > 0 && (
            <p>
              {record.labels.map((label, index) => (
                <Fragment key={`${label.id}-${label.catno ?? ""}-${index}`}>
                  {index > 0 ? " " : null}
                  <span className="name-with-comma">
                    <button type="button" className="text-button" onClick={() => onOpen("label", label.id)}>
                      {label.name}
                    </button>
                    {label.catno ? ` · ${label.catno}` : ""}
                    {index < record.labels.length - 1 ? "," : null}
                  </span>
                </Fragment>
              ))}
            </p>
          )}
          <p className="detail-actions">
            {useLabel && (
              <>
                <button type="button" className="text-button" onClick={onUse}>
                  {useLabel}
                </button>
                {" · "}
              </>
            )}
            <a className="text-button" href={discogsHref(record.type, record.id)} target="_blank" rel="noreferrer">
              Discogs
            </a>
          </p>
        </div>
      </div>
      {(record.genres.length > 0 || record.styles.length > 0) && (
        <p className="tags">{[...record.genres, ...record.styles].join(" · ")}</p>
      )}
      {record.year && (
        <p>
          {record.year}
          {record.country ? ` · ${record.country}` : ""}
        </p>
      )}
      {blurb && <p className="blurb">{blurb}</p>}
      {record.tracklist.length > 0 && (
        <ol className="tracks">
          {record.tracklist.map((track) => (
            <li key={`${track.position}-${track.title}`}>
              <span className="track-pos">{track.position}</span>
              <span className="track-main">
                <NameButtons
                  items={track.artists.map((artist, index) => ({
                    key: `${artist.id}-${index}`,
                    id: artist.id,
                    label: artist.anv || artist.name,
                  }))}
                  onPick={(id) => onOpen("artist", id)}
                />
                {track.artists.length > 0 ? " – " : ""}
                {track.title}
              </span>
              {track.duration ? <span className="track-time">{track.duration}</span> : null}
            </li>
          ))}
        </ol>
      )}
      {record.urls.length > 0 && (
        <ul className="urls">
          {record.urls.map((url) => (
            <li key={url}>
              <a href={url}>{url}</a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
