import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ThemeName = "light" | "dark";

export type ThemePalette = {
  bg: string;
  fg: string;
  nodes: {
    artist: string;
    label: string;
    release: string;
    fallback: string;
  };
  ink: readonly [number, number, number];
};

type ThemeContextValue = {
  theme: ThemeName;
  palette: ThemePalette;
  toggle: () => void;
};

const THEME_KEY = "dis-theme";
// Keep this aligned with the token transition in theme.css.
export const THEME_MOTION_MS = 420;

const PALETTES: Record<ThemeName, ThemePalette> = {
  light: {
    bg: "#ffffff",
    fg: "#000000",
    nodes: {
      artist: "#8c3d2f",
      label: "#1e6a4a",
      release: "#2c4e7a",
      fallback: "#221c16",
    },
    ink: [0, 0, 0],
  },
  dark: {
    bg: "#000000",
    fg: "#ffffff",
    nodes: {
      artist: "#73c2d0",
      label: "#e195b5",
      release: "#d3b185",
      fallback: "#dde3e9",
    },
    ink: [255, 255, 255],
  },
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(readInitialTheme);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // The attribute swaps the page tokens. `palette` is the destination; the graph
  // samples the live tokens while they ease so it fades with the rest of the page.
  document.documentElement.dataset.theme = theme;
  const palette = PALETTES[theme];

  const toggle = useCallback(() => {
    const next: ThemeName = themeRef.current === "light" ? "dark" : "light";
    swapTheme(next, setTheme);
  }, []);

  const value = useMemo(() => ({ theme, palette, toggle }), [theme, palette, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [scene, setScene] = useState(theme);
  const [held, setHeld] = useState(false);
  const [phase, setPhase] = useState<"idle" | "switching" | "settle">("idle");
  const skyRef = useRef<HTMLSpanElement>(null);
  const label = theme === "light" ? "Switch to dark mode" : "Switch to light mode";

  useEffect(() => {
    if (phase !== "switching") return;
    const sky = skyRef.current;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setScene(theme);
      setPhase("settle");
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === sky && event.propertyName === "transform") finish();
    };
    sky?.addEventListener("transitionend", onEnd);
    const backup = window.setTimeout(finish, THEME_MOTION_MS + 80);
    return () => {
      sky?.removeEventListener("transitionend", onEnd);
      window.clearTimeout(backup);
    };
  }, [phase, theme]);

  useEffect(() => {
    if (phase !== "settle") return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPhase("idle"));
    });
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const className = ["theme-toggle", phase === "switching" ? "is-switching" : "", phase === "settle" ? "is-settle" : "", held ? "is-held" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={className}
      data-scene={scene}
      aria-label={label}
      title={label}
      onPointerLeave={() => setHeld(false)}
      onClick={(event) => {
        if (phase === "switching") return;
        if (event.detail !== 0) setHeld(true);
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        toggle();
        if (reduced) {
          setScene((current) => (current === "light" ? "dark" : "light"));
          return;
        }
        setPhase("switching");
      }}
    >
      <span className="theme-sky" ref={skyRef}>
        <span className="theme-stars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
      <span className="theme-stars" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="theme-glyph theme-sun">
        <SunIcon />
      </span>
      <span className="theme-glyph theme-moon">
        <MoonIcon />
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.1 5.1l1.8 1.8M17.1 17.1l1.8 1.8M18.9 5.1l-1.8 1.8M6.9 17.1l-1.8 1.8" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M14.1 4.2A8 8 0 1 0 18.7 18.1A7.4 7.4 0 0 1 14.1 4.2z" />
    </svg>
  );
}

// Computed tokens, including the in-between values while the theme eases.
export function readLivePalette(): ThemePalette {
  const style = getComputedStyle(document.documentElement);
  const fg = cssColor(style.getPropertyValue("--fg"), PALETTES.light.fg);
  return {
    bg: cssColor(style.getPropertyValue("--bg"), PALETTES.light.bg),
    fg,
    nodes: {
      artist: cssColor(style.getPropertyValue("--node-artist"), PALETTES.light.nodes.artist),
      label: cssColor(style.getPropertyValue("--node-label"), PALETTES.light.nodes.label),
      release: cssColor(style.getPropertyValue("--node-release"), PALETTES.light.nodes.release),
      fallback: cssColor(style.getPropertyValue("--node-fallback"), PALETTES.light.nodes.fallback),
    },
    ink: hexChannels(fg),
  };
}

function cssColor(value: string, fallback: string): string {
  const parsed = parseCssColor(value.trim());
  return parsed ? hexFromChannels(parsed) : fallback;
}

function parseCssColor(value: string): [number, number, number] | null {
  if (value.startsWith("#")) {
    const body = value.slice(1);
    if (/^[0-9a-fA-F]{3}$/.test(body)) {
      const [r, g, b] = body.split("").map((channel) => Number.parseInt(channel + channel, 16));
      return [r, g, b];
    }
    if (/^[0-9a-fA-F]{6}$/.test(body)) {
      const channels = Number.parseInt(body, 16);
      return [(channels >> 16) & 255, (channels >> 8) & 255, channels & 255];
    }
  }
  const rgb = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (!srgb) return null;
  const channel = (part: string) => {
    const number = Number(part);
    return number <= 1 ? Math.round(number * 255) : Math.round(number);
  };
  return [channel(srgb[1]), channel(srgb[2]), channel(srgb[3])];
}

function hexFromChannels([r, g, b]: [number, number, number]): string {
  const hex = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hexChannels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function readInitialTheme(): ThemeName {
  const attr = document.documentElement.dataset.theme;
  if (attr === "dark" || attr === "light") return attr;
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Preference is optional.
  }
  return "light";
}

function swapTheme(next: ThemeName, setTheme: (theme: ThemeName) => void) {
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Preference is optional.
  }
  setTheme(next);
}
