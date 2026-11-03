# Dashboard components

The dashboard in `web/` is a React app built from [BoardUI](https://www.boardui.com) components. BoardUI ships components as source files, so they live in `web/src/components/` and we can change them. The free tier is MIT licensed (`web/src/components/BOARDUI-LICENSE`). Pro components need a paid key.

This note lists what we use today and which components fit the richer features we may build next.

## What we use today

| Where | BoardUI component | Notes |
| --- | --- | --- |
| Sidebar, phone drawer, page header | Sidebar recipe, Breadcrumb, Badge, Icon Button | Our own `Shell` in `app/shell.tsx`, built from the sidebar's classes. |
| Overview KPIs | Stat Cards (footer variant on wide screens, plain on phones) | We added a `trend` prop so "run time went down" shows a green down arrow. |
| Overview charts | Revenue and Orders chart cards | Rebuilt in `app/charts.tsx` for jobs per day and tokens per day. They keep the count-up headline and hover readout. |
| Running jobs, live log | Agent Thinking | Wave, spin and stars variants. The accent follows the theme. |
| Jobs list | Table, Data Table recipe (TanStack Table), Segmented Control, Select, Input, Pagination | Phones get a card list instead of the wide table. |
| Job page | Tabs, Chip, Switch, Button | Log, Summary, Details and Questions tabs. |
| Settings | Tabs, Input, Textarea, Select, Switch Card | |
| Dialogs, toasts | (not in the free tier) | `Modal`, `ToastProvider` and `ConfirmButton` in `app/ui.tsx`, built on React Aria with BoardUI tokens. |

### Themes

`web/src/styles/themes.css` holds five themes: Graphite (dark, the default), Daylight (light), Midnight, Ember and Matrix (high contrast). Each theme re-tints BoardUI's two colour ramps (`neutral-*` and `accent-*`), so every component follows without its own overrides. A theme that needs more (Matrix) also sets chart colours and a few targeted rules. The choice is saved in the browser.

To add a theme, add a block to `themes.css` and an entry to `THEMES` in `app/theme.tsx` and in the start-up script in `web/index.html`.

## The office

The pixel-art office at the top of the Overview is not a BoardUI component. It lives in `web/src/app/office/`:

- `office-view.tsx` is the React part: the 250px strip that grows into a square, the Live and Demo switch, the summary chip, and **Send work**. It turns `/api/jobs` and the pending questions into one entry per job (`id`, `status`, `question`) and passes them to the scene.
- `office-scene.ts` is plain three.js with no React, so the page lazy loads it (three.js is its own chunk). It builds the room from boxes with vertex colours merged into a few meshes, renders at a low resolution with depth and normal edge outlines, and the canvas is scaled up with nearest-neighbour filtering.

How it behaves:

- Each running or queued job gets one of the four agents (oldest first, running before queued). More than four active jobs show as "+N more" on the chip. A running job sends its agent to a free desk, where it sits and types and its screen scrolls. A queued job waits by the whiteboard. A pending question shows a `?` on the screen and the word `question`.
- When a job ends, its agent shows `shipped`, `issue` or `stopped` for a few seconds, then stands up and wanders again.
- Agents walk on a grid with A*, smooth their paths, and step aside for each other. They never teleport.
- Each theme has its own look (light, palette, outline and accent), and a theme change fades over about a second. Matrix renders in green.
- It draws at most 60 frames a second and stops when it is off screen, the tab is hidden, or WebGL is missing (then the strip is not shown at all). With `prefers-reduced-motion`, the strip does not animate its size.

To add a place for agents to go, add a spot in `buildWorld()` with an approach point, a facing and an activity. To add a status word, extend `ACTIVITY_WORD` or the job words in `animate()`. The 3x5 pixel font in `GLYPHS` covers A to Z, the digits and a few symbols (words are drawn in capitals).

## Components for richer features

### Watching an agent work

- **Agent Log** (free, not copied yet): the streaming machinery behind Task List. Use it to turn the raw log into steps.
- **Task List** (Pro): a streaming step list with a shimmering "running" title. Parse the CLI's stream-json events (tool calls, edits, test runs) into steps and show them above the raw terminal.
- **Agent Progress** (Pro): a collapsible multi-step progress block. It fits the fixed job phases: clone, set up runtimes, run agent, push, open PR.
- **Agent Limits Card** (Pro): context and token usage with a breakdown. Use it per job, and for plan limits if the CLIs report them.

### Questions and talking to agents

- **Questionnaire** (Pro): one question per step, with options and a free-text "Other" row. Use it when agents ask multiple-choice questions.
- **Composer Panel** or **Composer** (Pro), or **Agent Chat** (free): a proper reply box if questions become a back-and-forth chat with the agent.
- **Notification Center** (free): a bell inbox for questions, failed jobs and opened PRs, with unread state.
- **Notification** (free): timed, dismissible notices. It can replace our small toast if we want avatars and action buttons in it.

### Metrics

- **Combo Chart Card** (Pro): jobs per day as bars with the success rate as a line on a second axis.
- **Area Chart Card** (Pro): stacked areas, for example jobs or tokens per day split by model route.
- **Bar List Card** (Pro): ranked rows with share bars and tabs. It can replace our `Breakdown` (routes, repos, skills).
- **Heatmap Chart Card** or **Contributions Card** (Pro): runs by weekday and hour, or a GitHub-style activity grid.
- **Radial Chart Card** (Pro): a success-rate gauge.
- **Stage Bars Card** or **Funnel Chart Card** (Pro): ready, working, PR opened, merged.
- **Date Range Picker** (free): pick the metrics window instead of a fixed 30 days.

### Managing work

- **Project Board** (Pro): a kanban of issues by state (ready, working, done, failed). Dragging a card could start, retry or cancel a job.
- **Data Grid** (free): a virtualized table with column resizing, filters and CSV export, for a long job history.
- **Dropdown** and **Tooltip** (free): a row "more" menu on the jobs table (retry, cancel, open PR, copy branch).
- **Tree View** (free): browse a repo's skills folders when picking `skill:` labels.
- **Radio Card** and **Slider** (free): friendlier settings for the default route, concurrency and timeouts.
- **Avatar** (free): GitHub users in "who may start runs" and on answered questions.
- **Agent Avatar** (Pro): a small animated face per route or agent.

### Not in BoardUI

- **Command palette**: build it from React Aria's `Autocomplete`, `Menu` and `Modal`, with BoardUI's `Kbd` for shortcuts.
- **Diff viewer** for a job's changes: use a diff library and style it with BoardUI tokens.

## Adding a BoardUI component

The CLI copies source into a project: `npx boardui@latest add <name>`. It expects a Next.js layout, so for this Vite app it is easier to copy the file from the [BoardUI repository](https://github.com/BoardUI/boardui) into `web/src/components/` and keep the `@/` imports. Use semantic tokens only (`text-text-primary`, `bg-background-secondary-default` and so on), so the themes keep working.
