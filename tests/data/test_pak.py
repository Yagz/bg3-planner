import unittest

from scripts.data import pak
from tests.data import fixtures
from tests.data.fixtures import write_tmp


class TestPak(unittest.TestCase):
    def test_reads_the_filtered_files(self):
        p = write_tmp(fixtures.pak({"Public/A/x.lsx": b"<a/>", "Public/B/y.txt": b"yy"}))
        self.assertEqual(pak.read_pak(p, lambda n: n.endswith(".lsx")), {"Public/A/x.lsx": b"<a/>"})

    def test_long_lz4_literals(self):  # length > 15: extension bytes
        data = bytes(range(256)) * 3
        self.assertEqual(pak.lz4_block(fixtures.lz4_literals(data), len(data)), data)

    def test_refuses_an_unknown_format(self):
        with self.assertRaises(ValueError):
            pak.read_pak(write_tmp(b"XXXX" + bytes(16)), lambda n: True)
