#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Переименование изображений по названию товара (name), без использования колонки images для поиска файлов.

Исходный каталог:  data/catalog.csv   (чтение в CP1251)
Результат:         data/catalog_updated.csv (запись в UTF-8)
Исходный CSV не изменяется.

Перед переименованием копируется папка images/ → images_backup/

Запуск из корня проекта:
    python scripts/rename-images.py
"""

from __future__ import annotations

import csv
import re
import shutil
import sys
import uuid
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CSV_IN = ROOT / "data" / "catalog.csv"
CSV_OUT = ROOT / "data" / "catalog_updated.csv"
DIR_IMAGES = ROOT / "images"
DIR_BACKUP = ROOT / "images_backup"
ERRORS_LOG = ROOT / "errors.txt"

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp"}

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


def detect_delimiter(sample: str) -> str:
    if sample.count("\t") > sample.count(","):
        return "\t"
    return ","


def normalize_spaces(s: str) -> str:
    """Убираем лишние пробелы по краям и схлопываем внутренние."""
    return re.sub(r"\s+", " ", (s or "").strip())


def stem_matches_name(stem: str, product_name: str) -> bool:
    """
    Совпадение имени файла (без расширения) с name:
    — тот же текст с учётом схлопывания пробелов;
    — или name + только цифры в хвосте (с опциональным пробелом): «… действия 1», «…щит2».
    Сравнение без учёта регистра (учёт регистра ОС/файловой системы).
    """
    ns = normalize_spaces(stem).casefold()
    nn = normalize_spaces(product_name).casefold()
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


def trailing_number_for_sort(stem: str, product_name: str) -> int:
    """Порядок сортировки: без суффикса — 0, иначе число в конце."""
    ns = normalize_spaces(stem).casefold()
    nn = normalize_spaces(product_name).casefold()
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


def find_files_for_product(all_files: list[Path], product_name: str) -> list[Path]:
    name = (product_name or "").strip()
    if not name:
        return []
    matched: list[Path] = []
    for p in all_files:
        stem = p.stem
        if stem_matches_name(stem, name):
            matched.append(p)
    matched.sort(
        key=lambda path: (
            trailing_number_for_sort(path.stem, name),
            normalize_spaces(path.stem).casefold(),
        )
    )
    return matched


def backup_images_folder(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    if not src.is_dir():
        src.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)


def two_phase_rename(pairs: list[tuple[Path, Path]], errors_file) -> None:
    temps: list[tuple[Path, Path]] = []
    for src, dst in pairs:
        if not src.exists():
            errors_file.write(f"(rename) | {src} | исходный файл исчез перед переименованием\n")
            continue
        tmp = src.parent / f".__rename_tmp_{uuid.uuid4().hex}__{src.name}"
        src.rename(tmp)
        temps.append((tmp, dst))

    for tmp, dst in temps:
        if dst.exists() and tmp != dst:
            errors_file.write(f"(rename) | {dst} | целевой файл уже существует, пропуск\n")
            tmp.rename(tmp.parent / tmp.name.replace(".__rename_tmp_", ".__failed__"))
            continue
        tmp.rename(dst)


def main() -> int:
    if not CSV_IN.is_file():
        print(f"Ошибка: не найден входной файл {CSV_IN}", file=sys.stderr)
        return 1

    DIR_IMAGES.mkdir(parents=True, exist_ok=True)
    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)

    raw_head = CSV_IN.read_bytes().split(b"\n", 1)[0].decode("cp1251", errors="replace")
    delimiter = detect_delimiter(raw_head)

    rows: list[dict[str, str]] = []
    fieldnames: list[str] = []

    with CSV_IN.open("r", encoding="cp1251", newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        fieldnames = list(reader.fieldnames or [])
        if "name" not in fieldnames:
            print("Ошибка: в CSV должна быть колонка name.", file=sys.stderr)
            return 1
        if "images" not in fieldnames:
            print("Ошибка: в CSV должна быть колонка images.", file=sys.stderr)
            return 1
        for row in reader:
            rows.append({k: (v if v is not None else "") for k, v in row.items()})

    with ERRORS_LOG.open("w", encoding="utf-8") as ef:
        ef.write(f"# Запуск {datetime.now().isoformat(timespec='seconds')}\n")

        try:
            backup_images_folder(DIR_IMAGES, DIR_BACKUP)
        except OSError as e:
            ef.write(f"(система) | не удалось создать images_backup: {e}\n")
            print(f"Не удалось создать images_backup: {e}", file=sys.stderr)
            return 1

        all_files = list_image_files(DIR_IMAGES)

        # Предварительно: какие файлы подходят какому товару
        row_matches: list[list[Path]] = []
        for row in rows:
            nm = row.get("name") or ""
            row_matches.append(find_files_for_product(all_files, nm))

        # Один файл — только одна строка (порядок CSV): остальным конфликт
        path_owner: dict[Path, int] = {}
        for i, paths in enumerate(row_matches):
            kept: list[Path] = []
            for p in paths:
                key = p.resolve()
                if key not in path_owner:
                    path_owner[key] = i
                    kept.append(p)
                else:
                    owner = path_owner[key]
                    pname = normalize_spaces(rows[i].get("name") or "") or "(без названия)"
                    ef.write(
                        f"{pname} | файл уже отнесён к другой строке каталога (строка {owner + 1}): {p.name}\n"
                    )
            row_matches[i] = sorted(
                kept,
                key=lambda path: (
                    trailing_number_for_sort(path.stem, rows[i].get("name") or ""),
                    normalize_spaces(path.stem).casefold(),
                ),
            )

        used_stems: set[str] = set()
        planned_pairs: list[tuple[Path, Path]] = []
        updated_rows: list[dict[str, str]] = []

        for i, row in enumerate(rows):
            name = normalize_spaces(row.get("name") or "")
            sku = row.get("sku") or ""
            cell = row.get("images") or ""
            resolved_paths = row_matches[i]

            if not name:
                updated_rows.append(dict(row))
                continue

            new_images_cell = cell
            if not resolved_paths:
                ef.write(f"{name} | фото не найдено по названию\n")
            else:
                base_slug = slugify_product_name(name)
                stem = assign_unique_stem(base_slug, sku, used_stems)
                new_names = plan_new_filenames(stem, resolved_paths)
                for src, new_name in zip(resolved_paths, new_names):
                    dst = DIR_IMAGES / new_name
                    if src.resolve() != dst.resolve():
                        planned_pairs.append((src, dst))
                new_images_cell = ";".join(f"images/{n}" for n in new_names)

            out_row = dict(row)
            out_row["images"] = new_images_cell
            updated_rows.append(out_row)

        deduped_pairs: list[tuple[Path, Path]] = []
        seen_sources: set[Path] = set()
        seen_targets: set[Path] = set()
        for src, dst in planned_pairs:
            rs, rd = src.resolve(), dst.resolve()
            if rs in seen_sources:
                ef.write(f"(план) | {src.name} | один файл в плане переименования дважды — пропуск\n")
                continue
            if rd in seen_targets:
                ef.write(f"(план) | {dst.name} | коллизия целевого пути — пропуск\n")
                continue
            seen_sources.add(rs)
            seen_targets.add(rd)
            deduped_pairs.append((src, dst))

        two_phase_rename(deduped_pairs, ef)

    with CSV_OUT.open("w", encoding="utf-8", newline="") as fout:
        writer = csv.DictWriter(fout, fieldnames=fieldnames, delimiter=delimiter, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(updated_rows)

    print(f"Готово. Записан: {CSV_OUT}")
    print(f"Резервная копия изображений: {DIR_BACKUP}")
    print(f"Лог: {ERRORS_LOG}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
