/** Prints each engine's public key, the first path segment of its stream URLs. Run: pnpm tsx tools/stream-worker/keys.ts '<EVO_ENGINES value>' */
import { parseEngines } from "./src/core";

parseEngines(process.argv[2] ?? "").then((list) => {
  if (!list.length) console.error("No engines found in the value you gave.");
  for (const e of list) console.log(`${e.key}  ${e.url}`);
});
