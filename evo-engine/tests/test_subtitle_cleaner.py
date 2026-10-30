import unittest
from unittest import mock

from app.services.subtitle_cleaner import clean_text
from app.services.translation_service import SinhalaTranslator, anchor_of


class Rules(unittest.TestCase):
    def check(self, cases):
        for src, want in cases:
            with self.subTest(src=src):
                self.assertEqual(clean_text(src), want)

    def test_each_rule_removes_what_is_between_its_marks(self):
        self.check([
            ("Hello {whispers} there", "Hello there"),
            ("(Laughs) I know.", "I know."),
            ("Look out! [glass shatters]", "Look out!"),
            ("He said *sighs* fine", "He said fine"),
            ("# la la la # Come on", "Come on"),
        ])

    def test_nesting_and_line_breaks_inside_a_span(self):
        self.check([
            ("[a (b) c] Go", "Go"),
            ("[door\ncreaks] Who's there?", "Who's there?"),
            ("(one (two (three))) Fine", "Fine"),
        ])

    def test_marks_that_do_not_pair_are_plain_text(self):
        self.check([
            ("I'm fine :)", "I'm fine :)"),
            ("1) first 2) second", "1) first 2) second"),
            ("(never closes", "(never closes"),
            ("5 * 3 * 2 = 30", "5 * 3 * 2 = 30"),
            ("I'm #1, you're #2", "I'm #1, you're #2"),
            ("a single # here", "a single # here"),
        ])

    def test_a_removed_span_leaves_no_debris(self):
        self.check([
            ("- (SIGHS)\n- Hello", "- Hello"),
            ("<i>[phone rings]</i> Answer it", "Answer it"),
            ("Wait ( pause ) , what?", "Wait, what?"),
            ("A [x] and (y) and {z} B", "A and and B"),
        ])

    def test_cues_with_no_words_left_come_back_empty(self):
        for src in ("[MUSIC PLAYING]", "- (SIGHS)", "<i>[phone rings]</i>", "♪ (humming) ♪", "(a)\n[b]"):
            with self.subTest(src=src):
                self.assertEqual(clean_text(src), "")

    def test_text_without_annotations_is_untouched(self):
        for src in ("Hello there.", "♪", "...", "- Hi  there\n- Hey", "<i>Hello</i>"):
            with self.subTest(src=src):
                self.assertEqual(clean_text(src), src)

    def test_cleaning_twice_changes_nothing(self):
        once = clean_text("- (SIGHS) Hello [x]\n# la # Go on")
        self.assertEqual(clean_text(once), once)


class Job(unittest.TestCase):
    TIMES = ["00:00:0%d.000 --> 00:00:0%d.500" % (n, n) for n in range(1, 6)]
    TEXT = ["[MUSIC PLAYING]", "(Laughs) Yeah, but there's no art in that.", "No sophistication.", "- (SIGHS)", "Nothing sophisticated *sighs* about lying."]
    VTT = "WEBVTT\n\n" + "\n".join(f"{n}\n{t}\n{x}\n" for n, (t, x) in enumerate(zip(TIMES, TEXT), 1))

    def run_job(self):
        t = SinhalaTranslator(api_key="k")
        sent = []

        def chat(messages, task_id, temperature=0.3, as_json=False):
            if as_json:
                return '{"names":{}}'
            user = messages[1]["content"]
            sent.append(user)
            lines = [l for l in user.split("Cues to translate:\n")[1].split("\n") if l.strip()]
            out = []
            for l in lines:
                cid, text = l[1 : l.index("]")], l[l.index("]") + 2 :]
                out.append(f"[{cid}] {anchor_of(text)} | සිංහල {cid}")
            return "\n".join(out)

        t._chat = mock.Mock(side_effect=chat)
        return t.translate_vtt(self.VTT, "VisionQuest"), sent

    def test_the_model_never_sees_the_annotations_and_timings_stay_put(self):
        result, sent = self.run_job()
        asked = "\n".join(sent)
        for gone in ("MUSIC", "Laughs", "SIGHS", "sighs"):
            self.assertNotIn(gone, asked)
        self.assertEqual((result.cues, result.cleaned, result.emptied), (3, 4, 2))
        self.assertEqual(result.dropped_ads, 0)
        self.assertIn("4 cue(s) had annotations removed, 2 left empty and skipped", result.warnings)
        self.assertEqual(result.vtt.count("-->"), 3)
        for kept in (1, 2, 4):
            self.assertIn(self.TIMES[kept], result.vtt)
        for dropped in (0, 3):
            self.assertNotIn(self.TIMES[dropped], result.vtt)


if __name__ == "__main__":
    unittest.main()
