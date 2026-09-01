from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Parse one resume document with Docling and RapidOCR")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--max-pages", type=int, default=10)
    parser.add_argument("--max-chars", type=int, default=200_000)
    return parser.parse_args()


def configure_offline_cache(model_dir: Path) -> None:
    model_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("DOCLING_ARTIFACTS_PATH", str(model_dir))
    os.environ.setdefault("HF_HOME", str(model_dir / "huggingface"))


def convert_legacy_doc(source: Path, work_dir: Path) -> Path:
    executable = shutil.which("soffice") or shutil.which("libreoffice")
    if not executable:
        raise RuntimeError("旧版DOC需要本机LibreOffice转换为DOCX；请安装LibreOffice或将文件另存为DOCX")
    completed = subprocess.run(
        [executable, "--headless", "--convert-to", "docx", "--outdir", str(work_dir), str(source)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=45,
        check=False,
        shell=False,
    )
    converted = work_dir / f"{source.stem}.docx"
    if completed.returncode != 0 or not converted.is_file():
        message = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"旧版DOC转换失败: {message[-500:] or 'LibreOffice未生成DOCX'}")
    return converted


def build_converter() -> Any:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
    from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = True
    pipeline_options.do_table_structure = True
    pipeline_options.ocr_options = RapidOcrOptions(lang=["ch"], backend="onnxruntime")
    artifacts_path = os.environ.get("DOCLING_ARTIFACTS_PATH")
    if artifacts_path:
        pipeline_options.artifacts_path = Path(artifacts_path)

    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=pipeline_options),
        }
    )


def document_page_count(document: Any) -> int:
    pages = getattr(document, "pages", None)
    if isinstance(pages, dict):
        return len(pages)
    if pages is not None:
        try:
            return len(pages)
        except TypeError:
            pass
    return 0


def parse_document(input_path: Path, max_pages: int, max_chars: int) -> dict[str, Any]:
    extension = input_path.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"不支持的文档格式: {extension}")

    warnings: list[str] = []
    with tempfile.TemporaryDirectory(prefix="jobpilot-docling-") as temp_name:
        converter = build_converter()
        try:
            result = converter.convert(input_path)
        except Exception:
            if extension != ".doc":
                raise
            actual_input = convert_legacy_doc(input_path, Path(temp_name))
            result = converter.convert(actual_input)
            warnings.append("旧版DOC由LibreOffice本地兼容转换后识别")
        status = str(getattr(result, "status", "success")).lower()
        if "failure" in status:
            raise RuntimeError(f"Docling解析失败: {status}")
        document = result.document
        page_count = document_page_count(document)
        if page_count > max_pages:
            raise ValueError(f"文档超过{max_pages}页限制")

        text = document.export_to_markdown().strip()
        if len(text) > max_chars:
            text = text[:max_chars]
            warnings.append(f"识别文本超过{max_chars}字符，已截断")
        if not text:
            warnings.append("本地解析未识别到文本")
        if extension in {".doc", ".docx"} and len(text) < 100:
            warnings.append("Word可能主要由图片或复杂浮动排版组成")

        return {
            "text": text,
            "method": "docling-rapidocr" if extension in {".pdf", ".png", ".jpg", ".jpeg", ".webp"} else "docling-word",
            "pageCount": page_count,
            "warnings": warnings,
        }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def main() -> int:
    args = parse_args()
    try:
        input_path = args.input.resolve(strict=True)
        configure_offline_cache(args.model_dir.resolve())
        result = parse_document(input_path, max(1, args.max_pages), max(1, args.max_chars))
        write_json(args.output.resolve(), result)
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI boundary returns a concise diagnostic.
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
