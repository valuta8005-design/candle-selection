#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Общая логика: clean_name, поиск файлов в images/ по названию товара, slug для переименования.
Используется в rename-images.py и generate-candles-json.py.
"""

from __future__ import annotations

import re
from pathlib import Path

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp"}

_PHRASE_PATTERNS = (
    r"свеча\s*2\s*и\s*3\s*действия",
    r"свеча\s*[-–—]\s*талисман",
    r"свеча-талисман",
    r"свеча\s*[-–—]\s*программа",
    r"свеча-программа",
    r"\bсвеча\b",
)

_RE_QUOTES = re.compile(
    r'[\u0022\u0027\u00ab\u00bb\u201c\u201d\u201e\u2039\u203a'
    r"\u00b4\u0060\u2018\u2019\u201a\u201b]+"
)

_TRANSLIT = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ё": "yo",
    "ж": "zh",
    "з": "z",
    "и": "i",
    "й": "y",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "h",
    "ц": "ts",
    "ч": "ch",
    "ш": "sh",
    "щ": "sch",
    "ъ": "",
    "ы": "y",
    "ь": "",
    "э": "e",
    "ю": "yu",
    "я": "ya",
    "і": "i",
    "ї": "yi",
    "є": "ye",
    "ґ": "g",
}


def transliterate(text: str) -> str:
    parts = []
    for ch in text.lower():
        parts.append(_TRANSLIT.get(ch, ch))
    return "".join(parts)


def slugify_product_name(name: str) -> str:
    raw = transliterate((name or "").strip())
    raw = re.sub(r"[^a-z0-9]+", "-", raw)
    raw = re.sub(r"-+", "-", raw).strip("-")
    return raw or "product"


def sanitize_sku_fragment(sku: str) -> str:
    s = transliterate((sku or "").strip())
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:40] if s else ""


def normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def clean_name(raw: str) -> str:
    s = raw or ""
    for pat in _PHRASE_PATTERNS:
        s = re.sub(pat, " ", s, flags=re.IGNORECASE)
    s = _RE_QUOTES.sub(" ", s)
    s = re.sub(r"-{2,}", "-", s)
    s = normalize_spaces(s)
    s = s.strip(" -–—")
    return s


def stem_matches_clean_name(stem: str, clean: str) -> bool:
    ns = normalize_spaces(stem).casefold()
    nn = normalize_spaces(clean).casefold()
    if not nn:
        return False
    if ns == nn:
        return True
    if not ns.startswith(nn):
        return False
    rest = ns[len(nn) :].lstrip()
    if not rest:
        return True
    return rest.isdigit()


def trailing_number_for_sort(stem: str, clean: str) -> int:
    ns = normalize_spaces(stem).casefold()
    nn = normalize_spaces(clean).casefold()
    if ns == nn:
        return 0
    rest = ns[len(nn) :].lstrip()
    if rest.isdigit():
        return int(rest)
    return 10**9


def assign_unique_stem(base_slug: str, sku: str, used_stems: set[str]) -> str:
    stem = base_slug
    if stem not in used_stems:
        used_stems.add(stem)
        return stem
    frag = sanitize_sku_fragment(sku)
    if frag:
        candidate = f"{base_slug}-{frag}"
        if candidate not in used_stems:
            used_stems.add(candidate)
            return candidate
    n = 2
    while True:
        candidate = f"{base_slug}-{n}"
        if candidate not in used_stems:
            used_stems.add(candidate)
            return candidate
        n += 1


def plan_new_filenames(stem: str, paths: list[Path]) -> list[str]:
    ext_list = [p.suffix.lower() for p in paths]
    if len(paths) == 1:
        return [f"{stem}{ext_list[0]}"]
    return [f"{stem}-{i + 1}{ext_list[i]}" for i in range(len(paths))]


def list_image_files(images_dir: Path) -> list[Path]:
    out: list[Path] = []
    if not images_dir.is_dir():
        return out
    for p in images_dir.iterdir():
        if p.is_file() and p.suffix.lower() in ALLOWED_EXT:
            out.append(p)
    return out


def find_files_for_product(all_files: list[Path], clean: str) -> list[Path]:
    c = (clean or "").strip()
    if not c:
        return []
    matched: list[Path] = []
    for p in all_files:
        if stem_matches_clean_name(p.stem, c):
            matched.append(p)
    matched.sort(
        key=lambda path: (
            trailing_number_for_sort(path.stem, c),
            normalize_spaces(path.stem).casefold(),
        )
    )
    return matched


def disk_images_for_product(name: str, images_dir: Path) -> list[str]:
    """Список путей вида images/<имя_файла> по совпадению stem с clean_name(name)."""
    all_files = list_image_files(images_dir)
    matched = find_files_for_product(all_files, clean_name(name))
    return [f"images/{p.name}" for p in matched]
