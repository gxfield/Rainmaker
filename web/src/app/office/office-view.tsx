import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { RiAddLine, RiCollapseDiagonalLine, RiExpandDiagonalLine } from "@remixicon/react";
import { cx } from "@/utils/cx";
import type { Job, PendingQuestion } from "../api";
import { useTheme } from "../theme";
import type { OfficeJob, OfficeMode, OfficeScene, OfficeSummary } from "./office-scene";

const MODE_KEY = "rainmaker:office-mode";
const STRIP_HEIGHT = 250;

function storedMode(): OfficeMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "live" || v === "demo" ? v : null;
  } catch {
    return null;
  }
}

function describe(mode: OfficeMode, s: OfficeSummary | null): string {
  if (!s) return mode === "demo" ? "Demo" : "Live";
  const parts: string[] = [];
  if (s.working) parts.push(`${s.working} working`);
  if (s.question) parts.push(`${s.question} asking`);
  if (s.waiting) parts.push(`${s.waiting} waiting`);
  if (s.overflow) parts.push(`+${s.overflow} more`);
  return parts.length ? parts.join(" · ") : "All quiet";
}

/** Stops a click or key on the HUD from also growing or shrinking the office. */
const keep = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

/**
 * The office diorama on the Overview page: a 250px strip that grows to a square when clicked.
 * Agents follow the real running and queued jobs; with no job history (or in Demo) work
 * arrives at random. The three.js scene loads on its own, after the page.
 */
export function OfficeView({ jobs, questions, failed }: { jobs?: Job[]; questions?: PendingQuestion[]; failed?: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeScene | null>(null);
  const [theme] = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState({ width: 0, side: 0 });
  const [summary, setSummary] = useState<OfficeSummary | null>(null);
  const [ready, setReady] = useState(false);
  const [broken, setBroken] = useState(false);
  const [modePref, setModePref] = useState<OfficeMode | null>(storedMode);

  const noHistory = jobs !== undefined && jobs.length === 0;
  const mode: OfficeMode = modePref ?? (failed || noHistory ? "demo" : "live");

  const officeJobs = useMemo<OfficeJob[] | undefined>(() => {
    if (!jobs) return undefined;
    const asking = new Set((questions ?? []).filter((q) => q.status === "pending").map((q) => q.job_id));
    return jobs.map((j) => ({ id: j.id, status: j.status, question: asking.has(j.id) }));
  }, [jobs, questions]);

  // The full width, and the side of the square that fits the window.
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => {
      const width = Math.floor(el.clientWidth);
      const side = Math.max(STRIP_HEIGHT, Math.min(width, Math.floor(window.innerHeight - 48)));
      setSize((s) => (s.width === width && s.side === side ? s : { width, side }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Load three.js and the scene after the page has painted.
  useEffect(() => {
    let cancelled = false;
    import("./office-scene")
      .then(({ OfficeScene }) => {
        if (cancelled || !host.current) return;
        scene.current = new OfficeScene(host.current, { theme, mode, expanded, onSummary: setSummary });
        setReady(true);
      })
      .catch(() => !cancelled && setBroken(true));
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
      setReady(false);
    };
    // The scene is created once; the effects below keep it in sync.
  }, []);

  useEffect(() => {
    if (ready && size.width) scene.current?.setLayout(size.width, size.side);
  }, [ready, size]);
  useEffect(() => scene.current?.setTheme(theme), [ready, theme]);
  useEffect(() => scene.current?.setMode(mode), [ready, mode]);
  useEffect(() => scene.current?.setExpanded(expanded), [ready, expanded]);
  useEffect(() => {
    if (ready && officeJobs) scene.current?.setJobs(officeJobs);
  }, [ready, officeJobs]);

  // Bring the whole square into view once it has grown.
  useEffect(() => {
    if (!expanded) return;
    const t = window.setTimeout(() => box.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 480);
    return () => window.clearTimeout(t);
  }, [expanded]);

  if (broken) return null;

  const pickMode = (m: OfficeMode) => {
    setModePref(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // the choice just won't survive a reload
    }
  };

  const width = size.width ? (expanded ? size.side : size.width) : undefined;
  const height = expanded && size.side ? size.side : STRIP_HEIGHT;
  const label = `Office: ${describe(mode, summary)}. ${expanded ? "Press to shrink." : "Press to enlarge."}`;

  return (
    <div ref={outer} className="w-full">
      <div
        ref={box}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={label}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((x) => !x);
          } else if (e.key === "Escape") setExpanded(false);
        }}
        style={{ width: width ?? "100%", height }}
        className={cx(
          "group relative mx-auto max-w-full overflow-hidden rounded-2xl bg-background-secondary-default outline-none select-none",
          "transition-[width,height] duration-500 ease-[cubic-bezier(0.22,0.8,0.24,1)] motion-reduce:transition-none",
          "focus-visible:ring-2 focus-visible:ring-border-focus-ring",
          expanded ? "cursor-zoom-out" : "cursor-zoom-in",
        )}
      >
        {/* Shown until the scene's first frame. */}
        <div aria-hidden className={cx("absolute inset-0 animate-pulse bg-background-tertiary-default transition-opacity duration-700", ready ? "opacity-0" : "opacity-60")} />
        <div ref={host} aria-hidden className="absolute inset-0 overflow-hidden" />

        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1.5" onClick={keep} onKeyDown={keep}>
            <span className="flex items-center rounded-full border border-border-button-default bg-background-secondary-default/85 p-0.5 text-caption-1-medium backdrop-blur-sm">
              {(["live", "demo"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => pickMode(m)}
                  title={m === "live" ? "Agents follow your real jobs" : "Work arrives at random"}
                  className={cx(
                    "flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-0.5 capitalize transition-colors outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                    mode === m ? "bg-background-primary-default text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary",
                  )}
                >
                  {m === "live" && <span className={cx("size-1.5 rounded-full", mode === "live" ? "bg-lime-500" : "bg-current")} aria-hidden />}
                  {m}
                </button>
              ))}
            </span>
            <span className="rounded-full border border-border-button-default bg-background-secondary-default/85 px-2.5 py-1 text-caption-1-medium text-text-secondary tabular-nums backdrop-blur-sm max-sm:hidden">
              {describe(mode, summary)}
            </span>
            {mode === "demo" && (
              <button
                type="button"
                onClick={() => scene.current?.workArrives()}
                className="flex cursor-pointer items-center gap-1 rounded-full border border-border-button-default bg-background-secondary-default/85 px-2.5 py-1 text-caption-1-medium text-text-secondary backdrop-blur-sm transition-colors outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
              >
                <RiAddLine className="size-3.5" aria-hidden />
                Send work
              </button>
            )}
          </div>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-button-default bg-background-secondary-default/85 text-foreground-icon-secondary opacity-70 backdrop-blur-sm transition-opacity group-hover:opacity-100">
            {expanded ? <RiCollapseDiagonalLine className="size-4" aria-hidden /> : <RiExpandDiagonalLine className="size-4" aria-hidden />}
          </span>
        </div>
      </div>
    </div>
  );
}
