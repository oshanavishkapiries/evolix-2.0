// Cross-process claim race: run this in two processes at once (see claims.sh); every claim for the same key must name one engine.
//   EVO_ENGINES='["http://127.0.0.1:8001","http://127.0.0.1:8002"]' npx tsx --env-file=.env tests/e2e/claims.ts <key>
import { claimEngine } from "@/lib/evo/scheduler";
async function main() {
  const key = process.argv[2];
  const got = await Promise.all(Array.from({ length: 25 }, () => claimEngine(key)));
  console.log(JSON.stringify([...new Set(got.map((e) => e.id))]));
}
main().then(() => process.exit(), (e) => { console.error(e); process.exit(1); });
