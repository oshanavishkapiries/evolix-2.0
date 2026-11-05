import { connection } from "next/server";
import { openRouterStats } from "@/lib/openrouter";
import { StackChart } from "./stack-chart";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 })}`;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const PALETTE = ["#1a8cff", "#f5a623", "#8bc34a", "#ec4899", "#ff5a43", "#9a9a9a"];

/** OpenRouter spend, request volume by model and token use (needs a management key for the daily charts). Server-rendered. */
export async function OpenRouterPanel() {
  await connection();
  const or = await openRouterStats();
  return (
      <section>
        <h2>Usage</h2>
        {!or.ok ? (
          <>
            {or.key && (
              <div className="mb-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Today", or.key.daily],
                  ["This week", or.key.weekly],
                  ["This month", or.key.monthly],
                  ["All time", or.key.total],
                ].map(([label, v]) => (
                  <div key={label} className="stat">
                    <h3 className="text-sm font-semibold">{label}</h3>
                    <strong>{usd(v as number)}</strong>
                    {label === "All time" && or.key?.limit != null && (
                      <small>
                        {usd(or.key.remaining ?? 0)} left of {usd(or.key.limit)} limit
                      </small>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-sm">{or.message}</p>
          </>
        ) : (
          <>
            {or.credits && (
              <p className="mb-3 text-sm">
                Credits used {usd(or.credits.used)} of {usd(or.credits.total)} - {usd(or.credits.total - or.credits.used)} left
              </p>
            )}
            <div className="grid gap-4 lg:grid-cols-2">
              <StackChart
                title="Spend"
                days={or.days}
                type="area"
                format={(n) => `$${n.toFixed(n < 1 ? 2 : 0)}`}
                total={usd(sum(or.spend) + sum(or.byok))}
                series={[
                  { key: "byok", label: "BYOK", color: "#f5a623", values: or.byok },
                  { key: "spend", label: "OpenRouter spend", color: "#8b5cf6", values: or.spend },
                ]}
              />
              <StackChart
                title="Request volume by model"
                days={or.days}
                total={`${sum(or.models.flatMap((m) => m.values)).toLocaleString("en-US")} requests`}
                series={or.models.map((m, i) => ({ key: m.model, label: m.model, color: PALETTE[i % PALETTE.length], values: m.values }))}
              />
              <StackChart
                title="Token breakdown"
                days={or.days}
                total={`${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(sum(or.prompt) + sum(or.completion) + sum(or.reasoning))} tokens`}
                series={[
                  { key: "reasoning", label: "Reasoning", color: "#ff5a43", values: or.reasoning },
                  { key: "completion", label: "Completion", color: "#8b5cf6", values: or.completion },
                  { key: "prompt", label: "Prompt", color: "#1a8cff", values: or.prompt },
                ]}
              />
            </div>
          </>
        )}
      </section>
  );
}
