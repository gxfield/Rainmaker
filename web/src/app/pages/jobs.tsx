import { useMemo, useState } from "react";
import { RiAddLine, RiExternalLinkLine, RiInboxLine, RiSearchLine } from "@remixicon/react";
import { flexRender, getCoreRowModel, getPaginationRowModel, getSortedRowModel, useReactTable, type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { Pagination } from "@/components/base/pagination/pagination";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { ChevronSortDown } from "@/components/foundations/icons/chevrons";
import { cx } from "@/utils/cx";
import { useApi, type Job } from "../api";
import { ago, compact, duration } from "../format";
import { NewTaskModal } from "../new-task";
import { href, navigate } from "../router";
import { Shell } from "../shell";
import { EmptyState, Skeleton, StatusChip } from "../ui";
import type { PageNav } from "./overview";

type Filter = "all" | "active" | "succeeded" | "failed" | "cancelled";
const FILTERS: { id: Filter; label: string; test: (j: Job) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "active", label: "Active", test: (j) => j.status === "running" || j.status === "queued" },
  { id: "succeeded", label: "Succeeded", test: (j) => j.status === "succeeded" },
  { id: "failed", label: "Failed", test: (j) => j.status === "failed" },
  { id: "cancelled", label: "Cancelled", test: (j) => j.status === "cancelled" },
];
const PER_PAGE = 15;

function SortChevron({ dir }: { dir: false | "asc" | "desc" }) {
  return <ChevronSortDown className={cx("size-6 shrink-0 transition-[transform,color] duration-150", dir === "asc" && "rotate-180", dir ? "text-text-secondary" : "text-text-tertiary")} />;
}

/** Stops the row's own press handler, so a link inside a row opens the link only. */
const stop = { onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(), onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() };

function PrLink({ job }: { job: Job }) {
  if (!job.pr_url) return <span className="text-text-tertiary">–</span>;
  return (
    <a href={job.pr_url} target="_blank" rel="noreferrer" {...stop} className="inline-flex items-center gap-1 text-body-medium text-text-primary underline-offset-2 hover:underline">
      #{job.pr_number}
      <RiExternalLinkLine className="size-3.5 text-foreground-icon-tertiary" aria-hidden />
    </a>
  );
}

const tokens = (j: Job) => (j.input_tokens ?? 0) + (j.output_tokens ?? 0);

/** Phone layout: one card per job instead of a wide table. */
function JobCards({ jobs }: { jobs: Job[] }) {
  return (
    <ul className="flex flex-col gap-2 sm:hidden">
      {jobs.map((j) => (
        <li key={j.id}>
          <a href={href.job(j.id)} className="flex flex-col gap-2 rounded-2xl bg-background-secondary-default p-3 active:bg-background-secondary-hover">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 text-body-medium text-text-primary">{j.issue_title}</span>
              <StatusChip status={j.status} compact />
            </div>
            <span className="text-body-2-medium text-text-tertiary">
              {[`#${j.id}`, `${j.repo}#${j.issue_number}`, j.route, j.duration_ms === null ? null : duration(j.duration_ms), ago(j.created_at)].filter(Boolean).join(" · ")}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function JobsPage({ nav }: { nav: PageNav }) {
  const jobs = useApi<Job[]>("jobs?limit=1000", 5_000);
  const [filter, setFilter] = useState<Filter>("all");
  const [repo, setRepo] = useState("all");
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: PER_PAGE });
  const [newTask, setNewTask] = useState(false);

  const all = jobs.data ?? [];
  const repos = useMemo(() => [...new Set(all.map((j) => j.repo))].sort(), [all]);
  const data = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)!.test;
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return all.filter(
      (j) =>
        test(j) &&
        (repo === "all" || j.repo === repo) &&
        (!q || j.issue_title.toLowerCase().includes(q) || String(j.issue_number) === q || String(j.id) === q || (j.branch ?? "").toLowerCase().includes(q) || j.route.toLowerCase().includes(q)),
    );
  }, [all, filter, repo, query]);

  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Job",
        cell: ({ row: { original: j } }) => (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-body-medium text-text-primary">{j.issue_title}</span>
            <span className="truncate text-body-2-medium text-text-tertiary">
              #{j.id} · {j.repo}#{j.issue_number}
            </span>
          </div>
        ),
      },
      { id: "status", header: "Status", enableSorting: false, cell: ({ row }) => <StatusChip status={row.original.status} compact /> },
      {
        accessorKey: "route",
        header: "Route",
        cell: ({ row: { original: j } }) => (
          <Chip variant="subtle" color="gray">
            {j.route}
          </Chip>
        ),
      },
      {
        id: "duration",
        accessorFn: (j) => j.duration_ms ?? -1,
        header: "Time",
        cell: ({ row }) => <span className="text-body-medium text-text-primary tabular-nums">{duration(row.original.duration_ms)}</span>,
      },
      {
        id: "tokens",
        accessorFn: tokens,
        header: "Tokens",
        cell: ({ row }) => <span className="text-body-medium text-text-secondary tabular-nums">{tokens(row.original) ? compact(tokens(row.original)) : "–"}</span>,
      },
      { id: "pr", header: "PR", enableSorting: false, cell: ({ row }) => <PrLink job={row.original} /> },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ row }) => <span className="whitespace-nowrap text-body-medium text-text-secondary">{ago(row.original.created_at)}</span>,
      },
    ],
    [],
  );

  const table = useReactTable({
    data,
    columns,
    getRowId: (j) => String(j.id),
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const resetPage = () => table.setPageIndex(0);
  const rows = table.getRowModel().rows;
  const totalPages = table.getPageCount();
  const widths: Record<string, string> = { id: "w-[38%]", status: "w-[130px]", route: "w-[120px]", duration: "w-[100px]", tokens: "w-[100px]", pr: "w-[80px]", created_at: "w-[120px]" };

  return (
    <Shell
      route={{ page: "jobs" }}
      counts={nav.counts}
      version={nav.version}
      title="Jobs"
      actions={
        <Button variant="primary" leadingIcon={RiAddLine} onClick={() => setNewTask(true)}>
          New task
        </Button>
      }
    >
      <section className="flex w-full flex-col rounded-2xl border border-border-table pt-2 pb-3 max-sm:border-0 max-sm:pt-0">
        <div className="flex w-full flex-col items-start gap-3 px-3 py-1 max-sm:px-0 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col justify-center">
            <p className="text-body-medium text-text-tertiary">Results</p>
            <p className="text-body-medium text-text-primary">
              {data.length.toLocaleString()} job{data.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
            <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
              <SegmentedControl
                aria-label="Filter by status"
                selectedKeys={new Set([filter])}
                onSelectionChange={(keys) => {
                  const next = [...keys][0];
                  if (next) {
                    setFilter(next as Filter);
                    resetPage();
                  }
                }}
              >
                {FILTERS.map((f) => (
                  <SegmentedControlItem key={f.id} id={f.id}>
                    {f.label}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
            </div>
            <Select
              aria-label="Filter by repository"
              className="shrink-0"
              popoverClassName="min-w-56"
              selectedKey={repo}
              onSelectionChange={(k) => {
                setRepo(String(k));
                resetPage();
              }}
            >
              {[
                <SelectItem key="all" id="all" textValue="All repositories">
                  All repositories
                </SelectItem>,
                ...repos.map((r) => (
                  <SelectItem key={r} id={r} textValue={r}>
                    {r}
                  </SelectItem>
                )),
              ]}
            </Select>
            <InputBase
              aria-label="Search jobs"
              placeholder="Search title, #, branch"
              leadingIcon={RiSearchLine}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                resetPage();
              }}
              fieldClassName="min-w-[200px] flex-1 rounded-full bg-background-secondary-default sm:w-[220px] sm:flex-none"
              className="text-body-medium"
            />
          </div>
        </div>

        {jobs.loading && !jobs.data ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12 rounded-2lg" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="p-3 max-sm:px-0">
            <EmptyState icon={RiInboxLine} title={all.length ? "No jobs match these filters" : "No jobs yet"}>
              {all.length ? "Try another status, repository or search." : "Jobs show up here when an issue in a watched repo gets the agent:ready label."}
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="mt-2 hidden sm:block">
              <Table aria-label="Jobs" size="sm" onRowAction={(key) => navigate(href.job(Number(key)))} className="min-w-[860px] table-fixed">
                <TableHeader>
                  {table.getHeaderGroups()[0]!.headers.map((header) => {
                    const id = header.column.id;
                    const label = flexRender(header.column.columnDef.header, header.getContext());
                    return (
                      <TableColumn key={header.id} id={header.id} isRowHeader={id === "id"} className={widths[id]}>
                        {header.column.getCanSort() ? (
                          <button type="button" onClick={header.column.getToggleSortingHandler()} className="flex cursor-pointer items-center gap-0.5">
                            {label}
                            <SortChevron dir={header.column.getIsSorted()} />
                          </button>
                        ) : (
                          label
                        )}
                      </TableColumn>
                    );
                  })}
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id} id={row.id} className="cursor-pointer">
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className={widths[cell.column.id]}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <JobCards jobs={rows.map((r) => r.original)} />
          </>
        )}

        {totalPages > 1 && (
          <div className="mt-3 border-t border-separator-border px-3 pt-3 max-sm:px-0">
            <Pagination page={pagination.pageIndex + 1} totalPages={totalPages} onChange={(p) => table.setPageIndex(p - 1)} />
          </div>
        )}
      </section>

      {nav.overview && (
        <NewTaskModal
          isOpen={newTask}
          onClose={() => setNewTask(false)}
          repos={nav.overview.repos}
          routes={nav.overview.routes}
          defaultRoute={nav.overview.defaultRoute}
          onStarted={() => void jobs.reload()}
        />
      )}
    </Shell>
  );
}
