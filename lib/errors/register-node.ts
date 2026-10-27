import { captureException } from "./capture";

// Stack traces through the build's source maps, so recorded frames point at app/... and lib/... files.
process.setSourceMapsEnabled?.(true);
process.on("unhandledRejection", (reason) => void captureException(reason, { level: "error", tags: { mechanism: "unhandledRejection" } }));
process.on("uncaughtExceptionMonitor", (err) => void captureException(err, { level: "fatal", tags: { mechanism: "uncaughtException" } }));
