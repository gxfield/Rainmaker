import { useEffect, useState } from "react";

/**
 * Hash routing (#/jobs/12): the server only ever serves index.html, so deep links and
 * reloads work at any path prefix without server-side route lists.
 */
export type Route =
  | { page: "overview" }
  | { page: "jobs" }
  | { page: "job"; id: number }
  | { page: "questions" }
  | { page: "settings"; tab: string };

export function parse(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  const job = /^\/jobs\/(\d+)$/.exec(path);
  if (job) return { page: "job", id: Number(job[1]) };
  if (path === "/jobs") return { page: "jobs" };
  if (path === "/questions") return { page: "questions" };
  const settings = /^\/settings(?:\/([a-z-]+))?$/.exec(path);
  if (settings) return { page: "settings", tab: settings[1] ?? "general" };
  return { page: "overview" };
}

export const href = {
  overview: "#/",
  jobs: "#/jobs",
  job: (id: number) => `#/jobs/${id}`,
  questions: "#/questions",
  settings: (tab = "general") => `#/settings/${tab}`,
};

export function navigate(to: string): void {
  window.location.hash = to.replace(/^#/, "");
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parse(window.location.hash));
      document.querySelector("main")?.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
