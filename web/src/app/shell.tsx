import { useState, type ComponentType, type ReactNode } from "react";
import { RiCloseLine, RiDashboardLine, RiListCheck3, RiMenuLine, RiQuestionAnswerLine, RiSettings4Line } from "@remixicon/react";
import { Badge } from "@/components/base/badges/badge";
import { Breadcrumb, BreadcrumbItem } from "@/components/base/breadcrumb/breadcrumb";
import { IconButton } from "@/components/base/buttons/icon-button";
import { cx } from "@/utils/cx";
import { href, type Route } from "./router";
import { ThemePicker } from "./theme";

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="rm-logo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent-400)" />
          <stop offset="1" stopColor="var(--color-accent-600)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#rm-logo)" />
      <path d="M10.5 16.5a5 5 0 0 1 4.8-5 6 6 0 0 1 11.2 2.6A3.9 3.9 0 0 1 25.6 22H11.4a4.2 4.2 0 0 1-.9-5.5z" fill="white" opacity=".95" transform="translate(-2.5 -3)" />
      <path d="M11 23.5l-1.2 3M16 23.5l-1.2 3M21 23.5l-1.2 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity=".9" />
    </svg>
  );
}

function NavItem({ icon: Icon, label, to, selected, badge, onNavigate }: { icon: IconComponent; label: string; to: string; selected: boolean; badge?: number; onNavigate?: () => void }) {
  return (
    <a
      href={to}
      onClick={onNavigate}
      aria-current={selected ? "page" : undefined}
      className={cx(
        "flex w-full items-center justify-between gap-2 rounded-2lg p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus-ring",
        selected ? "bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected" : "hover:bg-background-secondary-hover",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className={cx("size-5 shrink-0", selected ? "text-white" : "text-foreground-icon-secondary")} aria-hidden />
        <span className={cx("text-body-medium whitespace-nowrap", selected ? "text-white" : "text-text-secondary")}>{label}</span>
      </span>
      {badge ? <Badge color={selected ? "primary" : "neutral"}>{badge}</Badge> : null}
    </a>
  );
}

export interface NavCounts {
  running: number;
  questions: number;
}

function Sidebar({ route, counts, version, mobile, onClose }: { route: Route; counts: NavCounts; version?: string; mobile?: boolean; onClose?: () => void }) {
  const page = route.page === "job" ? "jobs" : route.page;
  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col justify-between rounded-3xl border border-border-button-white bg-background-secondary-default p-3 shadow-sidebar">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <a href={href.overview} onClick={onClose} className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
            <Logo className="size-8" />
            <span className="flex flex-col">
              <span className="text-body-medium text-text-primary">Rainmaker</span>
              <span className="text-caption-1-medium text-text-tertiary">Agents for your repos</span>
            </span>
          </a>
          {mobile && (
            <button type="button" aria-label="Close navigation" onClick={onClose} className="cursor-pointer text-foreground-icon-secondary">
              <RiCloseLine className="size-5" aria-hidden />
            </button>
          )}
        </div>
        <nav className="flex flex-col gap-1">
          <NavItem icon={RiDashboardLine} label="Overview" to={href.overview} selected={page === "overview"} onNavigate={onClose} />
          <NavItem icon={RiListCheck3} label="Jobs" to={href.jobs} selected={page === "jobs"} badge={counts.running} onNavigate={onClose} />
          <NavItem icon={RiQuestionAnswerLine} label="Questions" to={href.questions} selected={page === "questions"} badge={counts.questions} onNavigate={onClose} />
          <NavItem icon={RiSettings4Line} label="Settings" to={href.settings()} selected={page === "settings"} onNavigate={onClose} />
        </nav>
      </div>
      <div className="flex flex-col gap-3">
        <ThemePicker />
        {version && <p className="px-1 text-caption-1-medium text-text-tertiary">Version {version}</p>}
      </div>
    </aside>
  );
}

/** Sidebar, phone drawer and page header, following BoardUI's app shell. */
export function Shell({
  route,
  counts,
  version,
  title,
  crumbs = [],
  actions,
  children,
}: {
  route: Route;
  counts: NavCounts;
  version?: string;
  title: ReactNode;
  crumbs?: { label: string; to: string }[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="relative flex h-dvh w-full gap-4 overflow-hidden bg-background-full p-3">
      <div className="hidden lg:flex">
        <Sidebar route={route} counts={counts} version={version} />
      </div>
      {navOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)} className="absolute inset-0 cursor-pointer bg-black/40" />
          <div className="relative flex h-full p-3">
            <Sidebar route={route} counts={counts} version={version} mobile onClose={() => setNavOpen(false)} />
          </div>
        </div>
      )}
      <main className="relative flex min-h-0 min-w-0 flex-1 justify-center overflow-x-hidden overflow-y-auto bg-background-full sm:pt-3">
        <div className="flex w-full max-w-[1300px] flex-col gap-2.5">
          <header className="flex w-full flex-col gap-2">
            <Breadcrumb>
              <BreadcrumbItem href={href.overview}>Rainmaker</BreadcrumbItem>
              {crumbs.map((c) => (
                <BreadcrumbItem key={c.to} href={c.to}>
                  {c.label}
                </BreadcrumbItem>
              ))}
              <BreadcrumbItem current>{typeof title === "string" ? title : "Details"}</BreadcrumbItem>
            </Breadcrumb>
            <div className="flex w-full flex-wrap items-end justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <IconButton icon={RiMenuLine} size="medium" aria-label="Open navigation" onClick={() => setNavOpen(true)} className="lg:hidden" />
                <h1 className="min-w-0 truncate px-1 text-title-2-medium text-text-primary">{title}</h1>
              </div>
              {actions && <div className="flex flex-wrap items-center justify-end gap-2.5">{actions}</div>}
            </div>
          </header>
          <div className="flex w-full flex-col gap-4 pb-4">{children}</div>
        </div>
      </main>
    </div>
  );
}
