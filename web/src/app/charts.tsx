import { useId, useState } from "react";
import { Area, Bar, BarChart, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Chip } from "@/components/base/badges/chip";
import { useCountUp } from "@/hooks/use-count-up";
import { cx } from "@/utils/cx";
import type { DayStats, GroupStats } from "./api";
import { compact, duration, money } from "./format";

/**
 * Chart cards for Rainmaker's 30-day metrics. They follow BoardUI's Revenue and Orders
 * chart cards: a count-up headline that switches to the hovered day, a legend, and
 * chart-* tokens so every theme recolours them.
 */

const dayLabel = (date: string) => {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function ActiveDot({ cx: x, cy: y }: { cx?: number; cy?: number }) {
  if (x === undefined || y === undefined) return null;
  return (
    <g>
      <circle cx={x} cy={y} r={7} fill="var(--color-chart-2-active)" opacity={0.25} />
      <circle cx={x} cy={y} r={4} fill="var(--color-chart-2-active)" stroke="var(--color-background-secondary-default)" strokeWidth={2} />
    </g>
  );
}

function Legend({ items }: { items: { label: string; className: string }[] }) {
  return (
    <dl className="flex shrink-0 items-center gap-4 text-body-2-medium text-text-secondary">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5">
          <span className={cx("size-2 rounded-full", i.className)} aria-hidden />
          <dt>{i.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Jobs per day: finished-well as the filled line, failures as the dashed one. */
export function ActivityChartCard({ data, className }: { data: DayStats[]; className?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const point = active !== null ? data[active] : undefined;
  const total = point ? point.total : data.reduce((s, d) => s + d.total, 0);
  const succeeded = point ? point.succeeded : data.reduce((s, d) => s + d.succeeded, 0);
  const failed = point ? point.failed : data.reduce((s, d) => s + d.failed, 0);
  const display = useCountUp(total);
  const rate = succeeded + failed ? Math.round((succeeded / (succeeded + failed)) * 100) : null;
  const yMax = Math.max(1, ...data.map((d) => Math.max(d.succeeded, d.failed)));

  return (
    <section className={cx("flex h-[344px] min-w-0 flex-1 flex-col gap-6 rounded-2xl bg-background-secondary-default px-4 pt-4 pb-3", className)}>
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-body-medium text-text-secondary">{point ? dayLabel(point.date) : `Jobs, last ${data.length} days`}</p>
          <div className="flex items-center gap-2">
            <p key={active ?? "all"} className="animate-number-fade text-title-1-medium whitespace-nowrap text-text-primary tabular-nums">
              {display}
            </p>
            {rate !== null && (
              <Chip variant="bold" color={rate >= 80 ? "lime" : rate >= 50 ? "neutral" : "rose"}>
                {rate}% ok
              </Chip>
            )}
          </div>
          <p className="text-body-2-medium text-text-tertiary tabular-nums">
            {succeeded} succeeded · {failed} failed
          </p>
        </div>
        <Legend items={[{ label: "Succeeded", className: "bg-chart-2-active" }, { label: "Failed", className: "bg-chart-3" }]} />
      </div>
      <div className="min-h-0 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 6, bottom: 0, left: 0 }}
            onMouseMove={(state) => {
              const index = Number(state?.activeTooltipIndex);
              if (state?.isTooltipActive && Number.isFinite(index)) setActive(index);
            }}
            onMouseLeave={() => setActive(null)}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis width={32} allowDecimals={false} domain={[0, Math.ceil(yMax * 1.15)]} tickCount={4} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} />
            <XAxis dataKey="date" tickFormatter={dayLabel} tickLine={false} axisLine={false} tickMargin={12} minTickGap={24} tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} />
            <Tooltip content={() => null} cursor={{ stroke: "var(--color-chart-cursor)", strokeWidth: 1, strokeDasharray: "4 4" }} />
            <Line type="monotone" dataKey="failed" stroke="var(--color-chart-3)" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={false} animationDuration={450} />
            <Area type="monotone" dataKey="succeeded" stroke="none" fill={`url(#${gradientId})`} animationDuration={450} />
            <Line type="monotone" dataKey="succeeded" stroke="var(--color-chart-2-active)" strokeWidth={2.5} dot={false} activeDot={<ActiveDot />} animationDuration={450} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/** Tokens per day as bars, with the API-equivalent cost in the headline. */
export function UsageChartCard({ data, className }: { data: DayStats[]; className?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const point = active !== null ? data[active] : undefined;
  const tokens = point ? point.tokens : data.reduce((s, d) => s + d.tokens, 0);
  const cost = point ? point.cost_usd : data.reduce((s, d) => s + d.cost_usd, 0);
  const display = useCountUp(tokens);

  return (
    <section className={cx("flex h-[344px] min-w-0 flex-1 flex-col gap-6 rounded-2xl bg-background-secondary-default px-4 pt-4 pb-3", className)}>
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-body-medium text-text-secondary">{point ? dayLabel(point.date) : "Tokens"}</p>
          <div className="flex items-center gap-2">
            <p key={active ?? "all"} className="animate-number-fade text-title-1-medium whitespace-nowrap text-text-primary tabular-nums">
              {compact(display)}
            </p>
            <Chip variant="bold" color="neutral">
              {money(cost)}
            </Chip>
          </div>
          <p className="text-body-2-medium text-text-tertiary">API-equivalent cost, as the CLIs report it</p>
        </div>
        <Legend items={[{ label: "Tokens", className: "bg-chart-9-active" }]} />
      </div>
      <div className="min-h-0 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            barCategoryGap="22%"
            margin={{ top: 4, right: 6, bottom: 0, left: 0 }}
            onMouseMove={(state) => {
              const index = Number(state?.activeTooltipIndex);
              if (state?.isTooltipActive && Number.isFinite(index)) setActive(index);
            }}
            onMouseLeave={() => setActive(null)}
          >
            <YAxis width={40} tickCount={4} tickFormatter={(v: number) => compact(v)} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} />
            <XAxis dataKey="date" tickFormatter={dayLabel} tickLine={false} axisLine={false} tickMargin={12} minTickGap={24} tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} />
            <Tooltip content={() => null} cursor={{ fill: "var(--color-background-secondary-hover)", radius: 6 }} />
            <Bar dataKey="tokens" fill="var(--color-chart-9-active)" radius={[4, 4, 0, 0]} animationDuration={450} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/** A ranked list with proportional bars: jobs per route or per repo. */
export function Breakdown({ title, rows, className }: { title: string; rows: GroupStats[]; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <section className={cx("flex min-w-0 flex-1 flex-col gap-4 rounded-2xl bg-background-secondary-default p-4", className)}>
      <h2 className="text-headline-medium text-text-primary">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-body-regular text-text-tertiary">No jobs in this window yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const finished = r.succeeded + r.failed;
            return (
              <li key={r.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-body-medium text-text-primary">{r.key}</span>
                  <span className="shrink-0 text-body-2-medium text-text-tertiary tabular-nums">
                    {r.total} jobs · {finished ? Math.round((r.succeeded / finished) * 100) : 0}% ok · {duration(r.avg_duration_ms)}
                  </span>
                </div>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-chart-track">
                  <span className="h-full bg-chart-2-active" style={{ width: `${(r.succeeded / max) * 100}%` }} />
                  <span className="h-full bg-chart-3" style={{ width: `${(r.failed / max) * 100}%` }} />
                  <span className="h-full bg-chart-neutral" style={{ width: `${((r.total - r.succeeded - r.failed) / max) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
