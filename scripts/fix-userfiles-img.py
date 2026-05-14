# -*- coding: utf-8 -*-
"""Replace userfiles/Images/*.jpg in catalog data with local images/logo."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
# Любой путь вида userfiles/Images/....jpg (в т.ч. битая кодировка «Феникс-3.jpg»)
PAT = re.compile(r"userfiles/Images/[^\s\"<>]+\.jpg", re.IGNORECASE)
NEW = "images/logo-volshebnyy-ogon.jpg"


def read_text_flex(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8", "utf-8-sig", "cp1251", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


FILES = [
    ROOT / "data" / "candles.json",
    ROOT / "data" / "candles-import.json",
    ROOT / "data" / "catalog_updated.csv",
    ROOT / "data" / "catalog.csv",
    ROOT / "catalog.csv",
]

for path in FILES:
    if not path.exists():
        print("skip missing:", path)
        continue
    text = read_text_flex(path)
    n_old = len(PAT.findall(text))
    text2 = PAT.sub(NEW, text)
    n_userfiles = text2.count("userfiles/")
    path.write_text(text2, encoding="utf-8", newline="\n")
    print(path.name, "replaced", n_old, "userfiles/Images/*.jpg ->", NEW)
    print("  remaining userfiles/ count:", n_userfiles)
