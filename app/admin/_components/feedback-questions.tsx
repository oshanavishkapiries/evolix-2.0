"use client";

import { useState } from "react";
import { adminApi, errorText } from "@/lib/client/admin";
import { MOMENTS, type Moment } from "@/lib/feedback";
import type { QuestionRow, QuestionStats } from "@/lib/cms/feedback-questions";
import { Switch } from "./switch";
import { useToast } from "./toast";

const scoreText = (q: QuestionRow, s: QuestionStats) =>
  s.score === null ? "—" : q.kind === "thumbs" ? `👍 ${Math.round(s.score)}%` : `${s.score.toFixed(1)} / 5`;

/** One row per player question: on/off, results at a glance, and an editor for wording, sample, target and priority. */
export function FeedbackQuestions({ questions, stats }: { questions: QuestionRow[]; stats: Record<string, QuestionStats> }) {
  const [rows, setRows] = useState(questions);
  const [editing, setEditing] = useState<string | null>(null);
  const toast = useToast();

  const save = async (key: string, patch: Partial<QuestionRow>) => {
    const res = await adminApi<{ question: QuestionRow }>("PATCH", `/api/admin/feedback/questions/${encodeURIComponent(key)}`, patch);
    if (!res.ok) {
      toast.error(errorText(res));
      return false;
    }
    setRows((all) => all.map((r) => (r.key === key ? res.question : r)));
    return true;
  };

  return (
    <div className="table-wrap mt-3">
      <table className="data-table">
        <thead>
          <tr>
            <th>Question</th>
            <th>On</th>
            <th>Sample</th>
            <th>Answers</th>
            <th>Result</th>
            <th>Top reasons</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => {
            const s = stats[q.key];
            const ignoredPct = s.shown ? Math.round((s.ignored / s.shown) * 100) : 0;
            return (
              <tr key={q.key}>
                <td style={{ maxWidth: "22rem" }}>
                  <strong>{q.prompt}</strong>
                  <div className="text-xs">
                    {q.key} · {q.kind === "thumbs" ? "👍 / 👎" : "5 faces"} · {MOMENTS[q.moment as Moment] ?? q.moment}
                  </div>
                  {editing === q.key && <Editor q={q} onCancel={() => setEditing(null)} onSave={async (patch) => (await save(q.key, patch)) && setEditing(null)} />}
                </td>
                <td>
                  <Switch
                    checked={q.active}
                    label={`Ask “${q.prompt}”`}
                    onToggle={async (next) => {
                      const ok = await save(q.key, { active: next });
                      if (ok) toast.success(next ? "Question on: viewers can be asked from now" : "Question off");
                      return ok;
                    }}
                  />
                </td>
                <td>{q.sampleRate}%</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {s.answered}
                  {q.target !== null && <> / {q.target}</>}
                  {q.target !== null && s.answered >= q.target && <div className="text-xs">target reached, not asked any more</div>}
                  {s.shown > 0 && q.key !== "experience" && <div className="text-xs">{ignoredPct}% ignored</div>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{scoreText(q, s)}</td>
                <td className="text-xs">{s.reasons.length ? s.reasons.map((r) => `${r.reason} (${r.n})`).join(", ") : "—"}</td>
                <td>
                  {editing !== q.key && (
                    <button type="button" className="btn-link rounded-md border px-2 py-1 text-xs" onClick={() => setEditing(q.key)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Editor({ q, onSave, onCancel }: { q: QuestionRow; onSave: (patch: Partial<QuestionRow>) => Promise<unknown>; onCancel: () => void }) {
  const [prompt, setPrompt] = useState(q.prompt);
  const [reasons, setReasons] = useState(q.reasons.join("\n"));
  const [sample, setSample] = useState(String(q.sampleRate));
  const [target, setTarget] = useState(q.target === null ? "" : String(q.target));
  const [priority, setPriority] = useState(String(q.priority));
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-2 grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSave({
          prompt: prompt.trim(),
          reasons: reasons.split("\n").map((r) => r.trim()).filter(Boolean),
          sampleRate: Number(sample),
          target: target.trim() ? Number(target) : null,
          priority: Number(priority),
        });
        setBusy(false);
      }}
    >
      <label className="text-xs">
        Question
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={120} required />
      </label>
      {q.key !== "experience" && (
        <label className="text-xs">
          Reasons after a negative answer (one per line)
          <textarea rows={4} value={reasons} onChange={(e) => setReasons(e.target.value)} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="text-xs">
          Sample %
          <input type="number" min={0} max={100} value={sample} onChange={(e) => setSample(e.target.value)} style={{ width: "6rem" }} />
        </label>
        <label className="text-xs">
          Stop after (answers)
          <input type="number" min={1} placeholder="never" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: "8rem" }} />
        </label>
        <label className="text-xs">
          Priority
          <input type="number" min={-100} max={100} value={priority} onChange={(e) => setPriority(e.target.value)} style={{ width: "6rem" }} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy}>Save</button>
        <button type="button" className="btn-link rounded-md border px-3 py-1 text-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
