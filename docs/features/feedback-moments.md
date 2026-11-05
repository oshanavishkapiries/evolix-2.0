# Player questions ("feedback moments")

Ask viewers about a feature right after they used it, without nagging. Every question, the old experience survey
included, spends from one budget per viewer.

```
 feature code: moments.moment("subtitle_picked", { afterPlayMs: 5 min })
        |
        v  client: one per viewing, not in the first 2 min, not right after a seek,
        |          nothing else on screen, local 3-day gap, not opted out
        v
 POST /api/me/ask  { moment, mediaKey, context }      lib/viewer/feedback.ts pickQuestion()
        |  budget: setting on, not opted out, 3 days since the last question (player_feedback too),
        |          max 2 in 7 days, no 2 ignored in a row in the last 30 days
        |  then the moment's active questions by priority: not seen (per title for once="title"),
        |  under target, inside sample %  -> row in feedback_asks (outcome "shown")
        v
 QuickQuestion (one tap)  -> PATCH /api/me/ask/:id  { value } / { reasons, comment } / { outcome: "ignored" }
```

- Tables: `feedback_questions` (admin-editable), `feedback_asks` (every ask and its answer), `feedback_prefs` (opt-out).
  Migration `drizzle/0017_feedback_moments.sql` seeds five questions; `experience` and `subtitle_sync` start on.
- The experience survey (emoji card) is the `experience` question: the server decides sample (35%) and budget; its
  answers still go to `player_feedback` and the existing Feedback page.
- Ignored = closed, faded after 12 s, or left the screen unanswered. "Don't ask me questions" sets `feedback_prefs`;
  viewers switch it back on in Account.
- Admin: Feedback -> Player questions (`/admin/feedback/questions`): on/off, wording, reasons, sample, target, priority,
  results and the latest answers with their context.

## Add a question

1. If no moment fits, add one to `MOMENTS` in `lib/feedback.ts` and fire it in the player with `moments.moment(...)`.
2. Insert the question (a migration, or SQL): `key`, `moment`, `kind` (`thumbs`/`faces`), `prompt`, `reasons`, `active`.
3. Tune it from the admin page. No deploy is needed for wording, sample, target, priority or on/off.

Testing: set `localStorage["v-fb-test"] = "1"` to skip the client waits (the server budget still applies).
Tests: `pnpm test:feedback` (budget and API), `tests/subtitles/player.spec.ts` (the card in the player).
