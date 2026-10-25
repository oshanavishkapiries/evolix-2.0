import unittest

from app.services.ffmpeg_downloader import relax_args

OLD = "  -allowed_extensions <string>     .D......... List of file extensions (default \"ts\")\n"
NEW = OLD.replace("allowed_extensions", "allowed_segment_extensions") + "  -extension_picky   <boolean>  .D......... Be picky (default true)\n"


class RelaxArgs(unittest.TestCase):
    def test_only_options_the_build_knows(self):
        self.assertEqual(relax_args(OLD), ["-allowed_extensions", "ALL"])
        self.assertEqual(relax_args(NEW), ["-allowed_segment_extensions", "ALL", "-extension_picky", "0"])
        self.assertEqual(relax_args(""), [])


if __name__ == "__main__":
    unittest.main()
