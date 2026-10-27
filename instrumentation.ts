import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("@/lib/errors/register-node");
}

/** Every error Next catches while rendering, in route handlers, server actions and the proxy. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureException } = await import("@/lib/errors/capture");
  await captureException(err, {
    url: request.path,
    method: request.method,
    route: context.routePath,
    headers: request.headers,
    tags: { mechanism: "onRequestError", routeType: context.routeType, renderSource: "renderSource" in context ? context.renderSource : undefined, routerKind: context.routerKind },
  });
};
