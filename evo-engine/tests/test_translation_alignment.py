import unittest
from unittest import mock

from app.core import runtime_config
from app.core.config import settings
from app.services import translation_service as ts
from app.services.translation_service import Cue, SinhalaTranslator, TranslationError

CUES = [
    Cue(1, "00:00:01.000 --> 00:00:02.000", "Thomas, I could have just taken his wallet."),
    Cue(2, "00:00:03.000 --> 00:00:04.000", "Yeah, but there's no art in that."),
    Cue(3, "00:00:05.000 --> 00:00:06.000", "No sophistication."),
    Cue(4, "00:00:07.000 --> 00:00:08.000", "Nothing sophisticated about lying to people."),
    Cue(5, "00:00:09.000 --> 00:00:10.000", "Yeah, says the pickpocket."),
]
SI = {1: "තෝමස්, මට පුළුවන්.", 2: "ඒත් ඒකේ කලාවක් නෑ.", 3: "ඒකේ උපායක් නෑ.", 4: "බොරු කියන එකේ ගතියක් නෑ.", 5: "ඔව්, සාක්කු හොරා කියනවා."}


def good(ids=None, shift=0):
    """What a careful model sends back. With `shift` the model skipped ahead: the line under id k is its translation of
    cue k+shift, and the anchor names the words it actually translated (the failure we are guarding against)."""
    out = []
    by_id = {c.id: c for c in CUES}
    for c in CUES:
        if ids is not None and c.id not in ids:
            continue
        src = by_id.get(c.id + shift)
        out.append(f"[{c.id}] {ts.anchor_of(src.text) if src else 'extra'} | {SI.get(c.id + shift, 'අමතර පේළියක්.')}")
    return "\n".join(out)


class Anchors(unittest.TestCase):
    def test_anchor_is_first_and_last_word(self):
        self.assertEqual(ts.anchor_of("Yeah, but there's no art in that."), "yeah…that")
        self.assertEqual(ts.anchor_of("No."), "no")
        self.assertEqual(ts.anchor_of("♪"), "-")
        self.assertEqual(ts.anchor_of("<i>Hello</i> ⏎ <i>there</i>"), "hello…there")

    def test_matching_ignores_case_punctuation_and_tags(self):
        self.assertTrue(ts.anchor_matches("Yeah, but there's no art in that.", "Yeah…that"))
        self.assertTrue(ts.anchor_matches("<i>No.</i>", "No"))
        self.assertTrue(ts.anchor_matches("♪♪", "-"))  # nothing to match
        self.assertFalse(ts.anchor_matches("No sophistication.", "Yeah…that"))
        self.assertFalse(ts.anchor_matches("No sophistication.", ""))

    def test_a_correct_answer_is_accepted(self):
        ok, refused = ts.decode_anchored(good(), CUES)
        self.assertEqual(ok, {i: SI[i] for i in SI})
        self.assertEqual(refused, set())

    def test_a_shifted_answer_is_refused_cue_by_cue(self):
        # The model skipped cue 1's text: every later line slid up by one. Anchors still name the right cue.
        ok, refused = ts.decode_anchored(good(shift=1), CUES)
        self.assertEqual(ok, {})
        self.assertEqual(refused, {1, 2, 3, 4, 5})

    def test_a_merged_pair_loses_only_the_cue_it_swallowed(self):
        body = good(ids={1, 2, 4, 5}).replace("[2] yeah…that | ", "[2] yeah…that | ")  # cue 3 was folded into cue 2
        ok, refused = ts.decode_anchored(body, CUES)
        self.assertEqual(set(ok), {1, 2, 4, 5})
        self.assertEqual(refused, set())  # cue 3 is simply missing: it will be asked for again

    def test_an_answer_without_an_anchor_is_not_trusted(self):
        ok, refused = ts.decode_anchored("[1] තෝමස්, මට පුළුවන්.\n[2] yeah…that | ඒත් ඒකේ කලාවක් නෑ.", CUES)
        self.assertEqual(ok, {2: SI[2]})
        self.assertEqual(refused, {1})

    def test_free_checks_catch_a_line_used_twice(self):
        texts = {2: "ඒක ඉතින් එහෙම තමයි.", 3: "ඒක ඉතින් එහෙම තමයි."}
        self.assertEqual(ts.sanity_refused(CUES, texts), {2, 3})
        self.assertEqual(ts.sanity_refused(CUES, {1: "x", 2: SI[2]}), {1})  # one letter for a whole sentence
        self.assertEqual(ts.sanity_refused(CUES, {i: SI[i] for i in SI}), set())


class Chunk(unittest.TestCase):
    def translator(self, replies):
        t = SinhalaTranslator(api_key="k")
        t.replies = list(replies)
        t._chat = mock.Mock(side_effect=lambda *a, **k: t.replies.pop(0))
        return t

    def test_a_shifted_first_answer_is_asked_for_again_and_the_second_is_used(self):
        t = self.translator([good(shift=1), good()])
        stats: dict = {}
        got = t._translate_chunk(CUES, [], "ctx", None, 0, stats)
        self.assertEqual(got, {i: SI[i] for i in SI})
        self.assertEqual(t._chat.call_count, 2)
        self.assertEqual(stats["refused"], 5)

    def test_only_the_refused_cues_are_asked_for_again(self):
        t = self.translator([good(ids={1, 2, 3}) + "\n[4] wrong…anchor | වැරදි.\n[5] yeah…pickpocket | ඔව්, සාක්කු හොරා කියනවා.", good(ids={4})])
        got = t._translate_chunk(CUES, [], "ctx", None, 0, {})
        self.assertEqual(got, {i: SI[i] for i in SI})
        second_user_message = t._chat.call_args_list[1].args[0][1]["content"]
        self.assertIn("[4]", second_user_message)
        self.assertNotIn("[1]", second_user_message)

    def test_a_cue_that_never_lines_up_stays_out_instead_of_being_wrong(self):
        always_bad = good(ids={1, 2, 3, 5}) + "\n[4] wrong…anchor | වැරදි."
        t = self.translator([always_bad] * 6)
        got = t._translate_chunk(CUES, [], "ctx", None, 0, {})
        self.assertEqual(set(got), {1, 2, 3, 5})  # cue 4 falls back to English when the file is built


class Job(unittest.TestCase):
    VTT = "WEBVTT\n\n" + "\n".join(f"{c.id}\n{c.timing}\n{c.text}\n" for c in CUES)

    def run_job(self, answer):
        t = SinhalaTranslator(api_key="k")

        def chat(messages, task_id, temperature=0.3, as_json=False):
            return '{"names":{}}' if as_json else answer(messages[1]["content"])

        t._chat = mock.Mock(side_effect=chat)
        return t.translate_vtt(self.VTT, "VisionQuest")

    def test_a_model_that_ignores_the_format_fails_the_job_instead_of_saving_english(self):
        with self.assertRaises(TranslationError):
            self.run_job(lambda user: "\n".join(f"[{c.id}] {SI[c.id]}" for c in CUES))  # no anchors at all

    def test_a_careful_model_gives_a_timing_exact_file(self):
        result = self.run_job(lambda user: good())
        self.assertEqual(result.translated, 5)
        for c in CUES:
            self.assertIn(c.timing, result.vtt)
        self.assertIn(SI[4], result.vtt)


class ModelSetting(unittest.TestCase):
    def test_the_translator_follows_the_setting_without_a_restart(self):
        t = SinhalaTranslator(api_key="k")
        with mock.patch.object(settings, "TRANSLATE_MODEL", "vendor/one"):
            self.assertEqual(t.model, "vendor/one")
        with mock.patch.object(settings, "TRANSLATE_MODEL", "vendor/two"):
            self.assertEqual(t.model, "vendor/two")

    def test_admin_may_only_set_a_plausible_model_id(self):
        self.assertEqual(runtime_config.coerce("TRANSLATE_MODEL", "  google/gemini-3.1-flash-lite  "), "google/gemini-3.1-flash-lite")
        self.assertEqual(runtime_config.coerce("TRANSLATE_MODEL", "meta-llama/llama-3.3-70b-instruct:free"), "meta-llama/llama-3.3-70b-instruct:free")
        for bad in ("", "no-slash", "a/b c", "a/b\nc", "x" * 200, 5, None):
            with self.assertRaises(ValueError):
                runtime_config.coerce("TRANSLATE_MODEL", bad)

    def test_it_is_listed_with_the_other_runtime_settings(self):
        row = next(r for r in runtime_config.snapshot({}) if r["key"] == "TRANSLATE_MODEL")
        self.assertEqual(row["kind"], "text")


if __name__ == "__main__":
    unittest.main()
