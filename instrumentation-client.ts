import { addBreadcrumb, installErrorReporting } from "@/lib/client/error-reporter";

try {
  installErrorReporting();
} catch {}

export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse") {
  addBreadcrumb("nav", `${navigationType} ${url}`);
}
