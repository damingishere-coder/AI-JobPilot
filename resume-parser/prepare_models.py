from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path


def main() -> int:
    project_root = Path(__file__).resolve().parent.parent
    model_dir = project_root / ".resume-models"
    model_dir.mkdir(parents=True, exist_ok=True)
    os.environ["DOCLING_ARTIFACTS_PATH"] = str(model_dir)
    os.environ["HF_HOME"] = str(model_dir / "huggingface")
    os.environ.pop("HF_HUB_OFFLINE", None)
    os.environ.pop("TRANSFORMERS_OFFLINE", None)

    from PIL import Image, ImageDraw
    from parse_document import build_converter

    with tempfile.TemporaryDirectory(prefix="jobpilot-model-prepare-") as temp_name:
        image_path = Path(temp_name) / "probe.png"
        image = Image.new("RGB", (900, 220), "white")
        ImageDraw.Draw(image).text((40, 80), "Resume OCR model readiness check 2026", fill="black")
        image.save(image_path)
        result = build_converter().convert(image_path)
        if result.document is None:
            raise RuntimeError("Docling模型准备失败")
    print(f"本地识别环境已准备：{model_dir}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"模型准备失败: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(2)
