import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AliasRef, Credit, EntityDetail, EntityType, IssuedLabel } from "../../src/shared/types";
import { ReleaseTracks } from "./ReleaseTracks";

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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function discogsHref(type: EntityType, id: number): string {
  return `https://www.discogs.com/${type}/${id}`;
}

function plural(word: string, count: number): string {
  if (count === 1) return word;
  return word.endsWith("s") ? `${word}es` : `${word}s`;
}

function mainArtists(record: EntityDetail): Credit[] {
  return record.credits.filter((credit) => credit.scope === "release" && credit.role === "Main" && (credit.anv || credit.name));
}

function formatReleased(released: string | null, year: number | null): string | null {
  const value = released?.trim();
  if (value) {
    const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(value);
    if (!match) return value;
    const yearText = match[1] ?? "";
    const month = match[2] && match[2] !== "00" ? Number(match[2]) : 0;
    const day = match[3] && match[3] !== "00" ? Number(match[3]) : 0;
    const monthName = month >= 1 && month <= 12 ? MONTHS[month - 1] : null;
    if (monthName && day >= 1 && day <= 31) return `${monthName} ${day}, ${yearText}`;
    if (monthName) return `${monthName} ${yearText}`;
    return yearText;
  }
  return year ? String(year) : null;
}

function FactNames({
  items,
  onPick,
}: {
  items: { key: string; id: number; label: string; note?: string | null }[];
  onPick: (id: number) => void;
}) {
  return items.map((item, index) => (
    <Fragment key={item.key}>
      {index > 0 ? " " : null}
      <span className="name-with-comma">
        {item.id > 0 ? (
          <button type="button" className="text-button" onClick={() => onPick(item.id)}>
            {item.label}
          </button>
        ) : (
          item.label
        )}
        {item.note ? ` · ${item.note}` : ""}
        {index < items.length - 1 ? "," : null}
      </span>
    </Fragment>
  ));
}

function labelItems(labels: IssuedLabel[]) {
  return labels.map((label, index) => ({
    key: `${label.id}-${label.catno ?? ""}-${index}`,
    id: label.id,
    label: label.name,
    note: label.catno,
  }));
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
  const artists = record.type === "release" ? mainArtists(record) : [];
  const released = formatReleased(record.released, record.year);
  const facts: { key: string; value: ReactNode; wide?: boolean }[] = [];
  if (record.realname) facts.push({ key: "Real name", value: record.realname });
  if (record.aliases.length > 0) {
    facts.push({
      key: plural("Alias", record.aliases.length),
      wide: true,
      value: <AliasList key={`${record.type}:${record.id}`} aliases={record.aliases} onPick={(id) => onOpen("artist", id)} />,
    });
  }
  if (record.parent) {
    const parent = record.parent;
    facts.push({
      key: "Parent",
      value: (
        <button type="button" className="text-button" onClick={() => onOpen("label", parent.id)}>
          {parent.name}
        </button>
      ),
    });
  }
  if (artists.length > 0) {
    facts.push({
      key: plural("Artist", artists.length),
      value: (
        <FactNames
          items={artists.map((artist, index) => ({
            key: `${artist.id}-${index}`,
            id: artist.id,
            label: artist.anv || artist.name,
          }))}
          onPick={(id) => onOpen("artist", id)}
        />
      ),
    });
  }
  if (record.labels.length > 0) {
    facts.push({
      key: plural("Label", record.labels.length),
      value: <FactNames items={labelItems(record.labels)} onPick={(id) => onOpen("label", id)} />,
    });
  }
  if (released) facts.push({ key: "Released", value: released });
  if (record.country) facts.push({ key: "Country", value: record.country });
  if (record.formatSummary.length > 0) {
    facts.push({ key: plural("Format", record.formatSummary.length), value: record.formatSummary.join(", ") });
  }
  if (record.genres.length > 0) facts.push({ key: plural("Genre", record.genres.length), value: record.genres.join(", ") });
  if (record.styles.length > 0) facts.push({ key: plural("Style", record.styles.length), value: record.styles.join(", ") });
  return (
    <article className="detail">
      <div className="detail-head">
        {image ? <img src={image} alt="" /> : <span className={`thumb placeholder large ${record.type}`}>{record.name.slice(0, 1)}</span>}
        <div className="detail-copy">
          <p className="eyebrow">{record.type}</p>
          <h2>{record.name}</h2>
          <p className="detail-actions">
            {useLabel && (
              <>
                <button type="button" className="text-button" onClick={onUse}>
                  {useLabel}
                </button>
                {" · "}
              </>
            )}
            <ExternalLink className="text-button" href={discogsHref(record.type, record.id)}>
              Discogs
            </ExternalLink>
          </p>
        </div>
      </div>
      {(facts.length > 0 || blurb || record.tracklist.length > 0) && (
        <div className="detail-body">
          {facts.length > 0 && (
            <ul className="facts">
              {facts.map((fact) => (
                <li key={fact.key} className={fact.wide ? "fact-wide" : undefined}>
                  <span className="fact-key">{fact.key}:</span>
                  {fact.wide ? <span className="fact-value">{fact.value}</span> : <> {fact.value}</>}
                </li>
              ))}
            </ul>
          )}
          {blurb && <p className="blurb">{blurb}</p>}
          {record.tracklist.length > 0 && <ReleaseTracks record={record} onOpen={onOpen} />}
        </div>
      )}
      {record.urls.length > 0 && (
        <ul className="urls">
          {record.urls.map((url) => (
            <li key={url}>
              <ExternalLink href={url}>{url}</ExternalLink>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ExternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a className={className ? `external-link ${className}` : "external-link"} href={href} target="_blank" rel="noreferrer">
      <span>{children}</span>
      <ExternalLinkIcon />
    </a>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
