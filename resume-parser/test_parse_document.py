from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import parse_document


class ParseDocumentUnitTest(unittest.TestCase):
    def test_write_json_keeps_unicode_and_replaces_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            output = Path(temp_name) / "result.json"
            parse_document.write_json(output, {"text": "中文简历", "warnings": []})

            payload = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual("中文简历", payload["text"])
            self.assertFalse(output.with_suffix(".json.tmp").exists())

    def test_page_count_supports_docling_page_mapping(self) -> None:
        document = type("Document", (), {"pages": {1: object(), 2: object()}})()

        self.assertEqual(2, parse_document.document_page_count(document))

    def test_rejects_unsupported_extension_before_loading_docling(self) -> None:
        with tempfile.TemporaryDirectory() as temp_name:
            source = Path(temp_name) / "resume.exe"
            source.write_bytes(b"MZ")

            with self.assertRaisesRegex(ValueError, "不支持"):
                parse_document.parse_document(source, 10, 200_000)


if __name__ == "__main__":
    unittest.main()
