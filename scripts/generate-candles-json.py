#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генерация data/candles.json из data/catalog_updated.csv (UTF-8).

Запуск из корня проекта:
    python scripts/generate-candles-json.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

from catalog_images_resolve import disk_images_for_product


ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "catalog_updated.csv"
JSON_PATH = ROOT / "data" / "candles.json"

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


def slugify_id(name: str) -> str:
    """Латиница, нижний регистр, дефисы — для поля id."""
    raw = transliterate((name or "").strip())
    raw = re.sub(r"[^a-z0-9]+", "-", raw)
    raw = re.sub(r"-+", "-", raw).strip("-")
    return raw or "product"


def detect_delimiter(sample: str) -> str:
    if sample.count("\t") > sample.count(","):
        return "\t"
    return ","


def normalize_image_token(token: str) -> str:
    t = (token or "").strip().strip('"').strip("'")
    t = t.replace("\\", "/").strip()
    return t


def parse_images_cell(cell: str) -> list[str]:
    if not cell or not str(cell).strip():
        return []
    parts = re.split(r"[;,]", str(cell))
    out = [normalize_image_token(p) for p in parts if normalize_image_token(p)]
    return out


def resolve_images_for_row(name: str, csv_tokens: list[str], root: Path) -> list[str]:
    """
    Берём пути из колонки images, только если каждый локальный путь указывает на существующий файл.
    Иначе (старые 16327.png, userfiles/..., пусто) — подбор файлов в images/ по названию товара.
    """
    images_dir = root / "images"
    valid_from_csv: list[str] = []
    use_csv = True
    for tok in csv_tokens:
        t = normalize_image_token(tok)
        if not t:
            continue
        if re.match(r"(?i)^https?://", t):
            valid_from_csv.append(t)
            continue
        if "userfiles" in t.lower():
            use_csv = False
            break
        u = t.replace("\\", "/").lstrip("./")
        while u.lower().startswith("images/images/"):
            u = "images/" + u[14:].lstrip("/")
        if not u.lower().startswith("images/"):
            if "/" in u:
                use_csv = False
                break
            u = f"images/{u}"
        p = root / u
        if not p.is_file():
            use_csv = False
            break
        valid_from_csv.append(u.replace("\\", "/"))
    if use_csv and valid_from_csv:
        return valid_from_csv
    return disk_images_for_product(name, images_dir)


def category_from_row(row: dict[str, str]) -> str:
    """Одна строка category: лист каталога (после последнего >>) или всё поле."""
    raw = (row.get("category_1") or "").strip()
    if not raw:
        return ""
    if ">>" in raw:
        return raw.split(">>")[-1].strip()
    return raw


def pick_url(row: dict[str, str]) -> str:
    u = (row.get("full_url") or "").strip()
    if u:
        return u
    return (row.get("URL") or "").strip()


def unique_id(base: str, used: set[str]) -> str:
    if base not in used:
        used.add(base)
        return base
    n = 2
    while True:
        cand = f"{base}-{n}"
        if cand not in used:
            used.add(cand)
            return cand
        n += 1


def main() -> int:
    if not CSV_PATH.is_file():
        print(f"Ошибка: не найден {CSV_PATH}", file=sys.stderr)
        return 1

    raw_head = CSV_PATH.read_text(encoding="utf-8", errors="replace").split("\n", 1)[0]
    delimiter = detect_delimiter(raw_head)

    items: list[dict] = []
    used_ids: set[str] = set()
    no_photo = 0
    no_url = 0

    with CSV_PATH.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        for row in reader:
            r = {k: (v if v is not None else "") for k, v in row.items()}
            name = (r.get("name") or "").strip()
            sku = (r.get("sku") or "").strip()
            price = (r.get("price") or "").strip()
            description = (r.get("description") or "").strip()
            images = resolve_images_for_row(
                name, parse_images_cell(r.get("images") or ""), ROOT
            )
            url = pick_url(r)
            cat = category_from_row(r)

            if not images:
                no_photo += 1
            if not url:
                no_url += 1

            base_id = slugify_id(name)
            pid = unique_id(base_id, used_ids)

            items.append(
                {
                    "id": pid,
                    "name": name,
                    "sku": sku,
                    "price": price,
                    "category": cat,
                    "description": description,
                    "images": images,
                    "url": url,
                }
            )

    JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with JSON_PATH.open("w", encoding="utf-8") as out:
        json.dump(items, out, indent=2, ensure_ascii=False)

    n = len(items)
    print(f"Обработано товаров: {n}")
    print(f"Без фото (пустой images): {no_photo}")
    print(f"Без URL: {no_url}")
    print(f"Записан файл: {JSON_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
