#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Переименование изображений товаров по SEO-slug из названия (name) и обновление CSV.

Исходный каталог:  data/catalog.csv   (чтение в CP1251)
Результат:         data/catalog_updated.csv (запись в UTF-8)
Исходный CSV не изменяется.

Перед переименованием копируется папка images/ → images_backup/

Запуск из корня проекта:
    python scripts/rename-images.py

Или из любой директории (скрипт сам находит корень по расположению файла):
    python path/to/rename-images.py
"""

from __future__ import annotations

import csv
import re
import shutil
import sys
import uuid
from datetime import datetime
from pathlib import Path


# --- пути относительно корня проекта (родитель каталога scripts/) ---
ROOT = Path(__file__).resolve().parent.parent
CSV_IN = ROOT / "data" / "catalog.csv"
CSV_OUT = ROOT / "data" / "catalog_updated.csv"
DIR_IMAGES = ROOT / "images"
DIR_BACKUP = ROOT / "images_backup"
ERRORS_LOG = ROOT / "errors.txt"


# Транслитерация кириллицы → латиница (упрощённая схема, удобная для URL)
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
    "і": "i",  # украинская
    "ї": "yi",
    "є": "ye",
    "ґ": "g",
}


def transliterate(text: str) -> str:
    """Кириллица и латиница в нижний регистр; остальное оставляем для последующей чистки."""
    parts = []
    for ch in text.lower():
        parts.append(_TRANSLIT.get(ch, ch))
    return "".join(parts)


def slugify_product_name(name: str) -> str:
    """
    SEO-имя: только латиница и цифры, слова через дефис, без пробелов и спецсимволов.
    Пример: «Успех и выгода» → uspeh-i-vygoda
    """
    raw = transliterate((name or "").strip())
    # оставляем латиницу и цифры, всё остальное — в дефис
    raw = re.sub(r"[^a-z0-9]+", "-", raw)
    raw = re.sub(r"-+", "-", raw).strip("-")
    return raw or "product"


def sanitize_sku_fragment(sku: str) -> str:
    """Короткий безопасный фрагмент из SKU для разрешения коллизий имён."""
    s = transliterate((sku or "").strip())
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:40] if s else ""


def detect_delimiter(sample: str) -> str:
    """Автоопределение запятой или табуляции по первой строке файла."""
    if sample.count("\t") > sample.count(","):
        return "\t"
    return ","


def normalize_image_token(token: str) -> str:
    """Убрать кавычки, пробелы, префикс images/ у имени из CSV."""
    t = (token or "").strip().strip('"').strip("'")
    t = t.replace("\\", "/")
    if t.lower().startswith("images/"):
        t = t[len("images/") :]
    return t.strip()


def split_images_cell(cell: str) -> list[str]:
    """
    Колонка images может содержать несколько файлов через ; или , .
    Пользовательский пример: «файл1.png;файл2.png»
    """
    if not cell or not str(cell).strip():
        return []
    parts = re.split(r"[;,]", str(cell))
    return [normalize_image_token(p) for p in parts if normalize_image_token(p)]


def build_images_index(images_dir: Path) -> dict[str, Path]:
    """
    Индекс: ключ — имя файла в нижнем регистре (для Windows без учёта регистра),
    значение — реальный Path на диске.
    """
    index: dict[str, Path] = {}
    if not images_dir.is_dir():
        return index
    for p in images_dir.iterdir():
        if p.is_file():
            index[p.name.lower()] = p
    return index


def resolve_file(filename: str, index: dict[str, Path]) -> Path | None:
    """Найти файл по имени из CSV (без учёта регистра на Windows)."""
    if not filename:
        return None
    return index.get(filename.lower())


def log_error(errors_file, product_name: str, filename: str, reason: str) -> None:
    line = f"{product_name} | {filename} | {reason}\n"
    errors_file.write(line)


def backup_images_folder(src: Path, dst: Path) -> None:
    """
    Полная копия images → images_backup.
    Если images_backup уже есть — удаляем и копируем заново (свежий снимок перед переименованием).
    """
    if dst.exists():
        shutil.rmtree(dst)
    if not src.is_dir():
        src.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)


def two_phase_rename(pairs: list[tuple[Path, Path]], errors_file) -> None:
    """
    Переименование без коллизий «источник перезаписал цель»:
    1) src → временное имя в той же папке
    2) временное → dst
    """
    temps: list[tuple[Path, Path]] = []
    for src, dst in pairs:
        if not src.exists():
            log_error(errors_file, "(rename)", str(src), "исходный файл исчез перед переименованием")
            continue
        tmp = src.parent / f".__rename_tmp_{uuid.uuid4().hex}__{src.name}"
        src.rename(tmp)
        temps.append((tmp, dst))

    for tmp, dst in temps:
        if dst.exists() and tmp != dst:
            # не ожидается при корректном планировании; не затираем молча
            log_error(errors_file, "(rename)", str(dst), "целевой файл уже существует, пропуск")
            tmp.rename(tmp.parent / tmp.name.replace(".__rename_tmp_", ".__failed__"))
            continue
        tmp.rename(dst)


def assign_unique_stem(
    base_slug: str,
    sku: str,
    used_stems: set[str],
) -> str:
    """
    Уникальный «стем» для группы файлов одного товара (odnotovarnyy prefiks).
    При коллизии добавляем суффикс из sku или счётчика.
    """
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
    """
    Имена файлов без каталога: одно фото — stem.ext; несколько — stem-1.ext, stem-2.ext ...
    Расширение берём у каждого исходного файла (.png / .jpg / .webp).
    """
    ext_list = [p.suffix.lower() for p in paths]
    # нормализуем .jpeg → .jpg по желанию пользователя «поддерживать jpg» — оставляем как есть у файла
    if len(paths) == 1:
        return [f"{stem}{ext_list[0]}"]
    return [f"{stem}-{i + 1}{ext_list[i]}" for i in range(len(paths))]


def main() -> int:
    if not CSV_IN.is_file():
        print(f"Ошибка: не найден входной файл {CSV_IN}", file=sys.stderr)
        print("Создайте data/catalog.csv или скопируйте каталог под этим именем.", file=sys.stderr)
        return 1

    DIR_IMAGES.mkdir(parents=True, exist_ok=True)
    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)

    # Читаем сырую первую строку для разделителя
    raw_head = CSV_IN.read_bytes().split(b"\n", 1)[0].decode("cp1251", errors="replace")
    delimiter = detect_delimiter(raw_head)

    rows: list[dict[str, str]] = []
    fieldnames: list[str] = []

    with CSV_IN.open("r", encoding="cp1251", newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        fieldnames = list(reader.fieldnames or [])
        if "name" not in fieldnames or "images" not in fieldnames:
            print(
                "Ошибка: в CSV должны быть колонки name и images.",
                file=sys.stderr,
            )
            return 1
        for row in reader:
            rows.append({k: (v if v is not None else "") for k, v in row.items()})

    with ERRORS_LOG.open("w", encoding="utf-8") as ef:
        ef.write(f"# Запуск {datetime.now().isoformat(timespec='seconds')}\n")
        ef.write("# формат: название товара | имя файла | причина\n")

        # --- резервная копия ---
        try:
            backup_images_folder(DIR_IMAGES, DIR_BACKUP)
        except OSError as e:
            ef.write(f"(система) | images_backup | не удалось создать копию: {e}\n")
            print(f"Не удалось создать images_backup: {e}", file=sys.stderr)
            return 1

        # После копирования индекс тот же (имена файлов не менялись)
        index = build_images_index(DIR_IMAGES)

        used_stems: set[str] = set()
        planned_pairs: list[tuple[Path, Path]] = []

        updated_rows: list[dict[str, str]] = []

        for row in rows:
            name = (row.get("name") or "").strip()
            sku = row.get("sku") or ""
            cell = row.get("images") or ""

            tokens = split_images_cell(cell)
            resolved_paths: list[Path] = []
            missing_tokens: list[str] = []

            for tok in tokens:
                p = resolve_file(tok, index)
                if p is None:
                    missing_tokens.append(tok)
                    log_error(ef, name or "(без названия)", tok, "файл не найден в папке images")
                else:
                    resolved_paths.append(p)

            # один и тот же файл не должен попасть в список дважды (дубликаты в CSV)
            seen_resolved: set[Path] = set()
            deduped_paths: list[Path] = []
            for p in resolved_paths:
                rp = p.resolve()
                if rp not in seen_resolved:
                    seen_resolved.add(rp)
                    deduped_paths.append(p)
            resolved_paths = deduped_paths

            new_images_cell = cell
            if tokens and not missing_tokens and resolved_paths:
                base_slug = slugify_product_name(name)
                stem = assign_unique_stem(base_slug, sku, used_stems)
                new_names = plan_new_filenames(stem, resolved_paths)

                for src, new_name in zip(resolved_paths, new_names):
                    dst = DIR_IMAGES / new_name
                    if src.resolve() != dst.resolve():
                        planned_pairs.append((src, dst))

                rels = [f"images/{n}" for n in new_names]
                new_images_cell = ";".join(rels)

            elif tokens and missing_tokens:
                # частично или полностью не найдены — старую ячейку images не меняем
                new_images_cell = cell
            elif not tokens:
                new_images_cell = cell

            out_row = dict(row)
            out_row["images"] = new_images_cell
            updated_rows.append(out_row)

        # Выполняем переименования после планирования всех строк
        deduped_pairs: list[tuple[Path, Path]] = []
        seen_sources: set[Path] = set()
        seen_targets: set[Path] = set()
        for src, dst in planned_pairs:
            rs, rd = src.resolve(), dst.resolve()
            if rs in seen_sources:
                log_error(ef, "(план)", str(src), "один файл указан для переименования дважды — второй пропуск")
                continue
            if rd in seen_targets:
                log_error(ef, "(план)", str(dst), "коллизия целевого пути — пропуск")
                continue
            seen_sources.add(rs)
            seen_targets.add(rd)
            deduped_pairs.append((src, dst))

        two_phase_rename(deduped_pairs, ef)

    # Запись нового CSV в UTF-8
    with CSV_OUT.open("w", encoding="utf-8", newline="") as fout:
        writer = csv.DictWriter(fout, fieldnames=fieldnames, delimiter=delimiter, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(updated_rows)

    print(f"Готово. Записан: {CSV_OUT}")
    print(f"Резервная копия изображений: {DIR_BACKUP}")
    print(f"Лог ошибок (если были пропуски): {ERRORS_LOG}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
