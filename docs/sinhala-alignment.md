# Sinhala subtitles: keeping every line on its own cue

## The problem

The translator sends the model numbered English lines and rebuilds the file around the **original timings**. If the
model skips, merges or splits a cue, every Sinhala line after it slides onto the wrong cue: timings are right, the
words are not. The old code only checked that an id came back, so a slid line was saved as a success.

## What happens now (`evo-engine/app/services/translation_service.py`)

Each answer line is `[id] anchor | sinhala`, where the anchor is the first and last English word of the cue the model
translated (`[7] Yeah…that | ...`). The engine compares it with the real cue before accepting the line:

1. **Anchor** (`decode_anchored`): wrong or missing anchor -> the line is refused.
2. **Free checks** (`sanity_refused`): a Sinhala line far too short/long for its cue, or the same line under two
   different cues, is refused. These catch little on their own (3 of 717 lines on a known-shifted file); the anchor
   is the real guard.
3. **Retry**: only the refused cues are asked for again, then in halves. A cue that still does not line up stays
   English in the file (better than a wrong Sinhala line).
4. **Fail rather than half-translate**: if more than half the cues would stay English (`MAX_KEPT_ENGLISH`) the job
   fails, so a model that ignores the format cannot save a mostly-English subtitle.

Limit: the anchor is written *before* the translation, which makes the model look at the right cue, but a model can
still write a correct anchor over a wrong sentence. That is rare and not caught.

## Switching the model

Admin -> OpenRouter -> Translation model. One choice, applied to every engine through its runtime settings
(`TRANSLATE_MODEL`, no restart, next job). Existing subtitles are not touched. The id must be one OpenRouter lists.
Engines reject anything not shaped like `vendor/model`.

A model change can change cost and quality: watch the warnings on a few titles after switching.
