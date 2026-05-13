#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Читает data/candles.json (старая схема) и пишет data/candles-import.json
в формате candles-import-template.json (поля и порядок как в шаблоне).

Запуск из корня проекта:
    python scripts/convert-candles-schema.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
JSON_IN = ROOT / "data" / "candles.json"
JSON_OUT = ROOT / "data" / "candles-import.json"
TEMPLATE = ROOT / "candles-import-template.json"

RECOMMENDATION = "Рекомендуется использовать по инструкции, прилагаемой к свече."

# (название ситуации, ключевые подстроки в нижнем регистре)
SITUATION_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Деньги", ("деньги", "доход", "прибыль", "успех")),
    ("Любовь", ("любовь", "отношения", "семья", "брак")),
    ("Защита", ("защита", "враги", "негатив", "колдовство")),
    ("Здоровье", ("здоровье", "сила", "энергия", "целитель")),
    ("Очищение", ("очищение", "чистка")),
    ("Обучение", ("обучение", "знания", "учёба", "учеба")),
    ("Удача", ("удача", "шанс", "победа")),
]


def strip_html(html: str) -> str:
    if not html:
        return ""
    s = re.sub(r"<script[\s\S]*?>[\s\S]*?</script>", " ", html, flags=re.IGNORECASE)
    s = re.sub(r"<style[\s\S]*?>[\s\S]*?</style>", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def short_description_from_html(html: str, max_len: int = 180) -> str:
    plain = strip_html(html)
    if len(plain) <= max_len:
        return plain
    cut = plain[:max_len]
    last = cut.rfind(" ")
    if last > max_len // 2:
        cut = cut[:last]
    return cut.rstrip() + "…"


def normalize_image_path(p: str) -> str:
    s = (p or "").strip().replace("\\", "/")
    if not s:
        return ""
    if s.lower().startswith(("http://", "https://")):
        return s
    if "userfiles" in s.lower():
        s = Path(s).name
    while s.lower().startswith("images/images/"):
        s = "images/" + s[14:].lstrip("/")
    if s.lower().startswith("images/"):
        return s
    if "/" in s:
        s = Path(s).name
    return f"images/{s}" if s else ""


def infer_situations(category: str, description_html: str) -> list[str]:
    hay = f"{category or ''} {strip_html(description_html or '')}".lower()
    out: list[str] = []
    seen: set[str] = set()
    for label, keywords in SITUATION_RULES:
        if label in seen:
            continue
        if any(kw in hay for kw in keywords):
            out.append(label)
            seen.add(label)
    return out


def normalize_price_import(val) -> int:
    """
    Как в candles-import-template.json: price — число int.
    Строка из цифр → int; пусто / нецифровое → 0.
    """
    if val is None:
        return 0
    if isinstance(val, bool):
        return 0
    if isinstance(val, int):
        return val
    if isinstance(val, float):
        if val != val:  # NaN
            return 0
        return int(val)
    s = str(val).strip()
    if not s:
        return 0
    if re.fullmatch(r"\d+", s):
        return int(s)
    return 0


def template_key_order() -> list[str]:
    """Порядок ключей как у первого объекта в candles-import-template.json."""
    if not TEMPLATE.is_file():
        return [
            "id",
            "name",
            "category",
            "image",
            "shortDescription",
            "description",
            "situations",
            "recommendation",
            "price",
            "buyLink",
            "benefits",
            "upsell",
        ]
    with TEMPLATE.open("r", encoding="utf-8") as f:
        arr = json.load(f)
    if isinstance(arr, list) and arr and isinstance(arr[0], dict):
        return list(arr[0].keys())
    return [
        "id",
        "name",
        "category",
        "image",
        "shortDescription",
        "description",
        "situations",
        "recommendation",
        "price",
        "buyLink",
        "benefits",
        "upsell",
    ]


def build_item_dict(
    *,
    id_: str,
    name: str,
    category: str,
    image: str,
    short_description: str,
    description: str,
    situations: list[str],
    recommendation: str,
    price: int,
    buy_link: str,
    benefits: list[str],
    upsell: list[str],
    key_order: list[str],
) -> dict:
    raw = {
        "id": id_,
        "name": name,
        "category": category,
        "image": image,
        "shortDescription": short_description,
        "description": description,
        "situations": situations,
        "recommendation": recommendation,
        "price": price,
        "buyLink": buy_link,
        "benefits": benefits,
        "upsell": upsell,
    }
    return {k: raw[k] for k in key_order if k in raw}


def convert_item(raw: dict, key_order: list[str]) -> dict:
    images = raw.get("images")
    if not isinstance(images, list):
        images = []
    first = images[0] if images else ""
    image = normalize_image_path(str(first)) if first else ""

    desc = raw.get("description") or ""
    url = (raw.get("url") or "").strip()
    situations = infer_situations(str(raw.get("category") or ""), str(desc))
    benefits = list(situations) if situations else []

    return build_item_dict(
        id_=raw.get("id") or "",
        name=(raw.get("name") or "").strip(),
        category=(raw.get("category") or "").strip(),
        image=image,
        short_description=short_description_from_html(str(desc), 180),
        description=str(desc),
        situations=situations,
        recommendation=RECOMMENDATION,
        price=normalize_price_import(raw.get("price")),
        buy_link=url,
        benefits=benefits,
        upsell=[],
        key_order=key_order,
    )


def main() -> int:
    if not JSON_IN.is_file():
        print(f"Ошибка: не найден {JSON_IN}", file=sys.stderr)
        return 1

    key_order = template_key_order()

    with JSON_IN.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        print("Ошибка: ожидается JSON-массив в начале файла.", file=sys.stderr)
        return 1

    out_list: list[dict] = []
    no_photo = 0
    no_buy = 0

    for raw in data:
        if not isinstance(raw, dict):
            continue
        item = convert_item(raw, key_order)
        out_list.append(item)
        if not (item.get("image") or "").strip():
            no_photo += 1
        if not (item.get("buyLink") or "").strip():
            no_buy += 1

    JSON_OUT.parent.mkdir(parents=True, exist_ok=True)
    with JSON_OUT.open("w", encoding="utf-8") as f:
        json.dump(out_list, f, indent=2, ensure_ascii=False)

    n = len(out_list)
    print(f"Обработано товаров: {n}")
    print(f"Без фото (пустой image): {no_photo}")
    print(f"Без buyLink: {no_buy}")
    print()
    print("Пример первых 2 товаров:")
    for i, item in enumerate(out_list[:2], 1):
        print(f"--- Товар {i} ---")
        print(json.dumps(item, indent=2, ensure_ascii=False))
    print()
    if out_list:
        p0 = out_list[0].get("price")
        print(f"Тип поля price (первый товар): {type(p0).__name__} (значение: {repr(p0)})")
    print()
    print(f"Записан файл: {JSON_OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
