import { useMemo } from "react";
import { useApi, type Overview } from "./api";
import { JobPage } from "./pages/job";
import { JobsPage } from "./pages/jobs";
import { OverviewPage, type PageNav } from "./pages/overview";
import { QuestionsPage } from "./pages/questions";
import { SettingsPage } from "./pages/settings";
import { useRoute } from "./router";

/** The overview feed drives the sidebar badges on every page, so it loads here. */
export function App() {
  const route = useRoute();
  const overview = useApi<Overview>("overview", 5_000);
  const nav: PageNav = useMemo(
    () => ({
      counts: { running: overview.data?.running ?? 0, questions: overview.data?.questions.length ?? 0 },
      version: overview.data?.version,
      overview: overview.data,
      reloadOverview: () => void overview.reload(),
    }),
    [overview.data, overview.reload],
  );

  switch (route.page) {
    case "jobs":
      return <JobsPage nav={nav} />;
    case "job":
      return <JobPage key={route.id} nav={nav} id={route.id} />;
    case "questions":
      return <QuestionsPage nav={nav} />;
    case "settings":
      return <SettingsPage nav={nav} tab={route.tab} />;
    default:
      return <OverviewPage nav={nav} />;
  }
}
