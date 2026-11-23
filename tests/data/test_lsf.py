import struct
import unittest

from scripts.data import lsf, lsx
from tests.data import fixtures

# One spec, written both as LSX and as LSF: attributes are {id: (LSX type, text)}.
SPEC = [
    {
        "id": "GameObjects",
        "attributes": {
            "Name": ("LSString", "Some name"),
            "Type": ("FixedString", "item"),
            "MapKey": ("guid", "32b1a84f-2e32-4249-8b19-ecaa7f279cb0"),
            "Flag": ("bool", "true"),
            "Off": ("bool", "false"),
            "Level": ("int32", "-12"),
            "DisplayName": ("TranslatedString", "h1a2b3c4dg5e6fg4a7bg8c9dg0e1f2a3b4c5d"),
            "Weight": ("float", "0.1"),
            "Count": ("uint8", "200"),
            "Big": ("int64", "-5000000000"),
            "Small": ("int8", "-3"),
            "Short": ("int16", "-300"),
            "UShort": ("uint16", "60000"),
            "UInt": ("uint32", "4000000000"),
            "Pos": ("fvec3", "1.5 -2 0.25"),
            "Empty": ("LSString", ""),
            "Accent": ("FixedString", "Élan"),
        },
        "children": [
            {"id": "Tags", "attributes": {"Object": ("guid", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")}, "children": []},
        ],
    },
    {"id": "Other", "attributes": {"Name": ("LSString", "x")}, "children": []},
    {"id": "GameObjects", "attributes": {"Name": ("FixedString", "second")}, "children": []},
]


def lsx_of(spec: list[dict], region: str = "Templates") -> bytes:
    def node(n: dict) -> str:
        attrs = ""
        for key, (kind, text) in n["attributes"].items():
            if kind == "TranslatedString":
                attrs += f'<attribute id="{key}" type="{kind}" handle="{text}" version="1"/>'
            else:
                attrs += f'<attribute id="{key}" type="{kind}" value="{text}"/>'
        children = "".join(node(c) for c in n["children"])
        block = f"<children>{children}</children>" if children else ""
        return f'<node id="{n["id"]}">{attrs}{block}</node>'

    body = "".join(node(n) for n in spec)
    return (
        f'<?xml version="1.0" encoding="UTF-8"?><save><region id="{region}">'
        f'<node id="root"><children>{body}</children></node></region></save>'
    ).encode("utf-8")


class TestLsf(unittest.TestCase):
    def assert_roundtrip(self, **options):
        data = fixtures.lsf({"Templates": SPEC}, **options)
        expected = lsx.nodes(lsx_of(SPEC), "GameObjects") + []
        all_nodes = lsf.read(data)
        self.assertEqual([n["id"] for n in all_nodes], ["GameObjects", "Other", "GameObjects"])
        self.assertEqual([n for n in all_nodes if n["id"] == "GameObjects"], expected)
        self.assertEqual(all_nodes[1], lsx.nodes(lsx_of(SPEC), "Other")[0])

    def test_roundtrip_uncompressed(self):
        self.assert_roundtrip()

    def test_roundtrip_compressed(self):
        self.assert_roundtrip(compressed=True)

    def test_roundtrip_versions_and_layouts(self):
        for version in (5, 6, 7):
            for metadata_format in (0, 1, 2):
                for compressed in (False, True):
                    with self.subTest(version=version, metadata_format=metadata_format, compressed=compressed):
                        self.assert_roundtrip(version=version, metadata_format=metadata_format, compressed=compressed)

    def test_several_regions(self):
        data = fixtures.lsf({"A": [SPEC[1]], "B": [SPEC[2]]})
        self.assertEqual([n["id"] for n in lsf.read(data)], ["Other", "GameObjects"])

    def test_nodes_filters_type(self):
        data = fixtures.lsf({"Templates": SPEC})
        found = lsf.nodes(data, "GameObjects")
        self.assertEqual([n["attributes"]["Name"] for n in found], ["Some name", "second"])
        self.assertEqual(lsf.nodes(data, "Tags"), [])  # only root-level nodes

    def test_guid_byte_order(self):  # known answer: .NET Guid(bytes) then LSLib's ByteSwapGuid
        self.assertEqual(lsf.guid(bytes(range(16))), "03020100-0504-0706-0908-0b0a0d0c0f0e")

    def test_float_shortest_text(self):
        self.assertEqual(lsf.float32_text(struct.unpack("<f", struct.pack("<f", 0.1))[0]), "0.1")
        self.assertEqual(lsf.float32_text(1.0), "1")
        self.assertEqual(lsf.float32_text(-2.5), "-2.5")
        self.assertEqual(lsf.float32_text(20.0), "20")
        self.assertEqual(lsf.float32_text(30.0), "30")
        self.assertEqual(lsf.float32_text(struct.unpack("<f", struct.pack("<f", 1e-05))[0]), "1e-05")

    def test_lz4_frame_linked_blocks(self):
        # Block 1: literals "abcd"; block 2: a match copying 8 bytes from block 1's output, then literals "Z".
        block1 = bytes([0x40]) + b"abcd"
        block2 = bytes([0x04]) + struct.pack("<H", 4) + bytes([0x10]) + b"Z"
        frame = struct.pack("<I", 0x184D2204) + bytes([0x40, 0x40, 0x00])
        frame += struct.pack("<I", len(block1)) + block1 + struct.pack("<I", len(block2)) + block2
        frame += struct.pack("<I", 0)
        self.assertEqual(lsf.lz4_frame(frame), b"abcdabcdabcdZ")

    def test_lz4_block_overlapping_match(self):
        # Literal "a", then a match of offset 1 and length 8 (token low nibble 4 + minimum 4) repeats the last byte.
        block = bytes([0x14]) + b"a" + struct.pack("<H", 1)
        out = bytearray()
        lsf._lz4_into(block, out)
        self.assertEqual(bytes(out), b"aaaaaaaaa")

    def test_lz4_block_non_overlapping_match(self):
        # Literals "abcd", then a match of offset 4 and length 6 copies "abcdab" from before it.
        block = bytes([0x42]) + b"abcd" + struct.pack("<H", 4)
        out = bytearray()
        lsf._lz4_into(block, out)
        self.assertEqual(bytes(out), b"abcdabcdab")

    def test_lz4_frame_stored_block(self):
        frame = struct.pack("<I", 0x184D2204) + bytes([0x40, 0x40, 0x00])
        frame += struct.pack("<I", 0x80000003) + b"xyz" + struct.pack("<I", 0)
        self.assertEqual(lsf.lz4_frame(frame), b"xyz")

    def test_bad_magic(self):
        with self.assertRaisesRegex(ValueError, "magic"):
            lsf.read(b"XXXX" + fixtures.lsf({"Templates": SPEC})[4:])

    def test_unsupported_version(self):
        data = bytearray(fixtures.lsf({"Templates": SPEC}))
        for version in (4, 8):
            data[4:8] = struct.pack("<I", version)
            with self.assertRaisesRegex(ValueError, f"version {version}"):
                lsf.read(bytes(data))

    def test_truncated(self):
        for compressed in (False, True):
            data = fixtures.lsf({"Templates": SPEC}, compressed=compressed)
            for size in (0, 10, 30, len(data) // 2, len(data) - 1):
                with self.subTest(compressed=compressed, size=size), self.assertRaisesRegex(ValueError, "truncated"):
                    lsf.read(data[:size])

    def test_unknown_type_is_refused(self):
        data = fixtures.lsf({"Templates": [{"id": "N", "attributes": {"Blob": ("ScratchBuffer", "")}, "children": []}]})
        with self.assertRaisesRegex(ValueError, "25"):
            lsf.read(data)


if __name__ == "__main__":
    unittest.main()
