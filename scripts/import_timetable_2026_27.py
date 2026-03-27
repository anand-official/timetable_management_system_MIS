import json
import re
import sqlite3
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple


NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
COMBINED_PREFIX = "__MIS_COMBINED_SLOT__="
GRADE_PREFIXES = ["XII", "VIII", "VII", "XI", "IX", "VI", "X", "V"]
DAY_KEYS = {"sun", "mon", "tue", "wed", "thu", "fri"}
MANUAL_TEACHERS = [
    {"name": "Ms. Rajani Shrestha", "abbreviation": "RJS"},
]
MANUAL_SUBJECT_TEACHERS = {
    ("VIA", "Innovation"): ["PSK"],
    ("VIB", "Innovation"): ["RJS"],
    ("VIB", "Science"): ["RR"],
    ("VIC", "Innovation"): ["AF"],
    ("VIC", "Science"): ["DD"],
    ("VID", "Science"): ["DD"],
    ("VIE", "Innovation"): ["PSK"],
    ("VIIB", "Innovation"): ["JS1", "SS"],
    ("VIIID", "Science"): ["MKG"],
    ("VIIIE", "Science"): ["BSD"],
    ("IXA", "Chemistry"): ["RR"],
    ("IXA", "Innovation"): ["NSS", "BSD"],
    ("IXB", "Chemistry"): ["RR"],
    ("IXC", "Chemistry"): ["RR"],
    ("IXD", "Chemistry"): ["RR"],
    ("IXD", "Innovation"): ["NSS", "MKG"],
    ("IXE", "Innovation"): ["EA", "MKG"],
    ("IXE", "Social Studies"): ["PP"],
    ("XA", "Geography"): ["SSB"],
    ("XB", "Geography"): ["SSB"],
    ("XB", "Innovation"): ["KKK", "KKS"],
    ("XC", "Geography"): ["DG"],
    ("XD", "Geography"): ["DG"],
    ("XE", "Chemistry"): ["RR"],
    ("XE", "Geography"): ["DG"],
    ("XF", "Chemistry"): ["RR"],
    ("XF", "Geography"): ["DG"],
    ("XIB", "Innovation"): ["SPK", "DT"],
    ("XIC", "Innovation"): ["NK", "KKS"],
    ("XIIB", "Innovation"): ["SPK", "AP"],
    ("XIIE", "Innovation"): ["ABF", "KKS"],
}


def norm_alnum(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def norm_alpha(value: str) -> str:
    return re.sub(r"[^A-Z]", "", (value or "").upper())


def is_repeat_marker(value: str) -> bool:
    compact = re.sub(r"[\s().-]", "", value or "")
    compact = compact.replace("L", "")
    return bool(compact) and all(ch in "\"“”‘’" for ch in compact)


def text_from_node(node: ET.Element) -> str:
    return "".join(text.text or "" for text in node.findall(".//w:t", NS)).strip()


def parse_docx_blocks(path: Path) -> List[Tuple[str, object]]:
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    body = root.find("w:body", NS)
    assert body is not None

    blocks: List[Tuple[str, object]] = []
    for child in list(body):
        tag = child.tag.split("}")[-1]
        if tag == "p":
            text = text_from_node(child)
            if text:
                blocks.append(("p", text))
        elif tag == "tbl":
            rows: List[List[str]] = []
            for tr in child.findall("w:tr", NS):
                rows.append([text_from_node(tc) for tc in tr.findall("w:tc", NS)])
            blocks.append(("tbl", rows))
    return blocks


def expand_sections(text: str, valid_sections: Set[str]) -> List[str]:
    source = (text or "").upper().replace(" ", "")
    found: List[str] = []
    index = 0

    while index < len(source):
        prefix = next((item for item in GRADE_PREFIXES if source.startswith(item, index)), None)
        if prefix is None:
            index += 1
            continue

        index += len(prefix)
        letters = ""
        while index < len(source):
            ch = source[index]
            if ch in "ABCDEF":
                letters += ch
                index += 1
                continue
            if ch in ",+/&":
                index += 1
                continue
            if ch == "(":
                depth = 1
                index += 1
                while index < len(source) and depth:
                    if source[index] == "(":
                        depth += 1
                    elif source[index] == ")":
                        depth -= 1
                    index += 1
                continue
            break

        for letter in letters:
            candidate = f"{prefix}{letter}"
            if candidate in valid_sections and candidate not in found:
                found.append(candidate)

    return found


def extract_class_heading_section(heading: str, valid_sections: Set[str]) -> Optional[str]:
    part = re.split(r"Teacher", heading, flags=re.IGNORECASE)[0]
    part = part.replace("Class:", "").replace("Class", "").strip(" :-")
    part = re.sub(r"C\.?\s*$", "", part).strip(" .:-")
    sections = expand_sections(part, valid_sections)
    return sections[0] if sections else None


def extract_teacher_part(heading: str) -> str:
    match = re.search(r"(?:Lab\.)?Teacher\s*[:-]\s*(.+)$", heading, re.IGNORECASE)
    return match.group(1) if match else heading


def match_teacher(heading: str, teachers: Sequence[dict], teachers_by_abbr: Dict[str, dict]) -> Optional[dict]:
    if "Teacher" not in heading:
        return None

    paren = re.search(r"\(([^()]*)\)\s*$", heading)
    if paren:
        abbr = norm_alnum(paren.group(1))
        if abbr in teachers_by_abbr:
            return teachers_by_abbr[abbr]

    teacher_part = extract_teacher_part(heading)
    teacher_key = norm_alpha(teacher_part)
    best: Optional[dict] = None
    best_score = 0.0
    for teacher in teachers:
        score = SequenceMatcher(None, teacher_key, norm_alpha(teacher["name"])).ratio()
        if score > best_score:
            best = teacher
            best_score = score
    return best if best_score >= 0.60 else None


def normalize_display(raw: str) -> str:
    text = (raw or "").strip()
    if not text or is_repeat_marker(text):
        return ""
    text = text.replace("‘’", "").replace("“", "").replace('"', "").strip()
    text = re.sub(r"\s+", " ", text)
    return text.strip(" .")


def canonical_subject_name(display: str) -> Optional[str]:
    key = norm_alnum(display)
    key = (
        key.replace("MATHSL", "MATHS")
        .replace("CHEML", "CHEM")
        .replace("BIOL", "BIO")
        .replace("PHYL", "PHY")
        .replace("COMPL", "COMP")
        .replace("ITL", "IT")
        .replace("IPL", "IP")
        .replace("AIL", "AI")
        .replace("BSTD", "BSTD")
    )

    if key.startswith("ENG"):
        return "English"
    if key.startswith("MATHS"):
        return "Mathematics"
    if key.startswith("SCI"):
        return "Science"
    if key.startswith("SSCI"):
        return "Social Studies"
    if key.startswith("PHY"):
        return "Physics"
    if key.startswith("CHEM"):
        return "Chemistry"
    if key.startswith("BIO"):
        return "Biology"
    if key.startswith("ECO"):
        return "Economics"
    if key.startswith("GEO"):
        return "Geography"
    if key.startswith("HIST"):
        return "History"
    if key.startswith("ACC"):
        return "Accountancy"
    if key.startswith("BSTD"):
        return "Business Studies"
    if key.startswith("COMP") or key.startswith("IT"):
        return "Computer Science"
    if key.startswith("IP"):
        return "Informatics Practices"
    if key.startswith("LIB"):
        return "Library"
    if key.startswith("GAME"):
        return "Games"
    if key.startswith("YOGA"):
        return "Yoga"
    if key.startswith("INNOV") or key == "AI":
        return "Innovation"
    if key.startswith("AEROBIC"):
        return "Aerobics"
    if key.startswith("WE"):
        return "Work Experience"
    if key.startswith("PSY") or key.startswith("SOCIO"):
        return "Social Studies"
    if key.startswith("ART"):
        return "Art"
    if key.startswith("MUSIC"):
        return "Music"
    if key.startswith("DANCE"):
        return "Dance"
    return None


def choose_subject_assignment(display: str, candidates: Sequence[dict]) -> Optional[dict]:
    target = canonical_subject_name(display)
    if target:
        for candidate in candidates:
            if candidate["subjectName"] == target:
                return candidate
        return None

    display_key = norm_alnum(display)
    for candidate in candidates:
        if display_key.startswith(norm_alnum(candidate["subjectCode"])):
            return candidate
        if display_key.startswith(norm_alnum(candidate["subjectName"])):
            return candidate
    return None


def compatible_subject_names(display: str) -> List[str]:
    key = norm_alnum(display)
    target = canonical_subject_name(display)
    compatible: List[str] = [target] if target else []

    if key.startswith("2NDL"):
        compatible = ["Hindi", "Nepali"]
    elif key.startswith("3RDL"):
        compatible = ["Hindi", "Nepali", "French"]
    elif key == "WE":
        compatible = ["Art", "Music", "Dance"]
    elif key.startswith("SCI"):
        compatible = ["Science", "Chemistry", "Biology"]
    elif key.startswith("AI") or key.startswith("INNOV"):
        compatible = ["Innovation"]
    elif key.startswith("AEROBIC"):
        compatible = ["Yoga", "Aerobics"]
    elif key.startswith("IP") or key.startswith("IT"):
        compatible = ["Informatics Practices", "Computer Science"]
    elif key.startswith("COMPECO"):
        compatible = ["Computer Science", "Informatics Practices", "Economics"]
    elif key.startswith("GEOECO"):
        compatible = ["Geography", "Economics"]
    elif "HSC" in key and ("IP" in key or "COMP" in key):
        compatible = ["Home Science", "Informatics Practices", "Computer Science"]
    elif key.startswith("MCH") or key.startswith("MHC") or key.startswith("MHIP") or key.startswith("MHIP"):
        compatible = ["Mathematics", "Home Science", "Informatics Practices", "Computer Science"]
    elif key.startswith("LAB"):
        if "PC" in key:
            compatible = ["Physics", "Chemistry"]
        elif "PB" in key or "BP" in key:
            compatible = ["Physics", "Biology"]
        elif "BC" in key or "CB" in key:
            compatible = ["Biology", "Chemistry"]
        else:
            compatible = ["Physics", "Chemistry", "Biology", "Computer Science", "Informatics Practices"]

    return [name for name in compatible if name]


def display_differs_from_subject(display: str, subject: Optional[dict]) -> bool:
    if subject is None:
        return True
    display_key = norm_alnum(display)
    return display_key not in {
        norm_alnum(subject["subjectCode"]),
        norm_alnum(subject["subjectName"]),
    }


def encode_combined_metadata(display: str, options: Sequence[dict]) -> str:
    payload = {
        "kind": "combined-slot",
        "displayName": display,
        "displayCode": display,
        "options": list(options),
    }
    return COMBINED_PREFIX + json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def build_teacher_slot_map(
    blocks: Sequence[Tuple[str, object]],
    teachers: Sequence[dict],
    teachers_by_abbr: Dict[str, dict],
    valid_sections: Set[str],
) -> Dict[Tuple[str, str, int], Set[str]]:
    teacher_slots: Dict[Tuple[str, str, int], Set[str]] = defaultdict(set)
    current_heading = ""

    for kind, payload in blocks:
        if kind == "p":
            current_heading = payload  # type: ignore[assignment]
            continue

        rows = payload  # type: ignore[assignment]
        teacher = match_teacher(current_heading, teachers, teachers_by_abbr)
        if not teacher or not rows or rows[0][0].upper() != "DAY":
            continue

        header = rows[0]
        junior_layout = len(header) >= 11
        period_cols = list(range(3, 11)) if junior_layout else list(range(1, 9))
        previous: List[str] = [""] * len(header)

        for row in rows[1:]:
            if len(row) < len(header):
                row += [""] * (len(header) - len(row))
            day_key = row[0].strip().lower()[:3]
            if day_key not in DAY_KEYS:
                continue

            for period_number, col_index in enumerate(period_cols, start=1):
                cell = row[col_index].strip()
                if is_repeat_marker(cell):
                    cell = previous[col_index]
                elif cell == "-":
                    cell = ""
                if cell:
                    previous[col_index] = cell

                for section_name in expand_sections(cell, valid_sections):
                    teacher_slots[(section_name, day_key, period_number)].add(teacher["id"])

    return teacher_slots


def build_teacher_section_map(
    blocks: Sequence[Tuple[str, object]],
    teachers: Sequence[dict],
    teachers_by_abbr: Dict[str, dict],
    valid_sections: Set[str],
) -> Dict[str, Set[str]]:
    section_teachers: Dict[str, Set[str]] = defaultdict(set)
    current_heading = ""

    for kind, payload in blocks:
        if kind == "p":
            current_heading = payload  # type: ignore[assignment]
            continue

        rows = payload  # type: ignore[assignment]
        teacher = match_teacher(current_heading, teachers, teachers_by_abbr)
        if not teacher or not rows or rows[0][0].upper() != "DAY":
            continue

        for row in rows[1:]:
            for cell in row[1:]:
                for section_name in expand_sections(cell, valid_sections):
                    section_teachers[section_name].add(teacher["id"])

    return section_teachers


def ensure_manual_teachers(conn: sqlite3.Connection) -> None:
    now = conn.execute("SELECT datetime('now')").fetchone()[0]
    for teacher in MANUAL_TEACHERS:
        exists = conn.execute(
            "SELECT id FROM Teacher WHERE abbreviation = ? OR name = ?",
            (teacher["abbreviation"], teacher["name"]),
        ).fetchone()
        if exists:
            continue
        teacher_id = f"impteach_{norm_alnum(teacher['abbreviation']).lower()}"
        conn.execute(
            """
            INSERT INTO Teacher (
              id, name, abbreviation, department, isHOD, targetWorkload, currentWorkload,
              isActive, teachableGrades, createdAt, updatedAt
            ) VALUES (?, ?, ?, '', 0, 24, 0, 1, '[]', ?, ?)
            """,
            (teacher_id, teacher["name"], teacher["abbreviation"], now, now),
        )


def load_tables(conn: sqlite3.Connection):
    conn.row_factory = sqlite3.Row

    teachers = [dict(row) for row in conn.execute("SELECT id, name, abbreviation FROM Teacher")]
    teachers_by_abbr = {norm_alnum(row["abbreviation"]): row for row in teachers}

    sections = [
        dict(row)
        for row in conn.execute(
            """
            SELECT Section.id, Section.name, Grade.name AS gradeName
            FROM Section
            JOIN Grade ON Grade.id = Section.gradeId
            """
        )
    ]
    sections_by_name = {row["name"]: row for row in sections}
    valid_sections = set(sections_by_name)

    subjects = [dict(row) for row in conn.execute("SELECT id, name, code FROM Subject")]
    subjects_by_name = {row["name"]: row for row in subjects}

    teacher_subject_rows = [
        dict(row)
        for row in conn.execute(
            """
            SELECT
              TeacherSubject.teacherId,
              TeacherSubject.subjectId,
              Section.name AS sectionName,
              Teacher.name AS teacherName,
              Teacher.abbreviation AS teacherAbbr,
              Subject.name AS subjectName,
              Subject.code AS subjectCode
            FROM TeacherSubject
            JOIN Section ON Section.id = TeacherSubject.sectionId
            JOIN Teacher ON Teacher.id = TeacherSubject.teacherId
            JOIN Subject ON Subject.id = TeacherSubject.subjectId
            """
        )
    ]

    section_teacher_subjects: Dict[Tuple[str, str], List[dict]] = defaultdict(list)
    section_subject_teachers: Dict[Tuple[str, str], List[dict]] = defaultdict(list)
    teacher_subject_keys: Set[Tuple[str, str, str]] = set()
    for row in teacher_subject_rows:
        section_teacher_subjects[(row["sectionName"], row["teacherId"])].append(row)
        section_subject_teachers[(row["sectionName"], row["subjectName"])].append(row)
        teacher_subject_keys.add((row["sectionName"], row["teacherId"], row["subjectId"]))

    days = {
        row["name"].lower()[:3]: row["id"]
        for row in conn.execute("SELECT id, name FROM Day ORDER BY dayOrder ASC")
    }
    time_slots = {
        row["periodNumber"]: row["id"]
        for row in conn.execute("SELECT id, periodNumber FROM TimeSlot ORDER BY periodNumber ASC")
    }

    return {
        "teachers": teachers,
        "teachers_by_abbr": teachers_by_abbr,
        "sections_by_name": sections_by_name,
        "valid_sections": valid_sections,
        "subjects_by_name": subjects_by_name,
        "section_teacher_subjects": section_teacher_subjects,
        "section_subject_teachers": section_subject_teachers,
        "teacher_subject_keys": teacher_subject_keys,
        "days": days,
        "time_slots": time_slots,
    }


def build_manual_subject_assignments(data: dict) -> Dict[Tuple[str, str], List[dict]]:
    manual: Dict[Tuple[str, str], List[dict]] = {}
    teachers_by_abbr = data["teachers_by_abbr"]
    subjects_by_name = data["subjects_by_name"]

    for (section_name, subject_name), teacher_abbrs in MANUAL_SUBJECT_TEACHERS.items():
        subject = subjects_by_name.get(subject_name)
        if subject is None:
            continue

        options: List[dict] = []
        for teacher_abbr in teacher_abbrs:
            teacher = teachers_by_abbr.get(norm_alnum(teacher_abbr))
            if teacher is None:
                continue
            options.append(
                {
                    "subjectId": subject["id"],
                    "subjectName": subject["name"],
                    "subjectCode": subject["code"],
                    "teacherId": teacher["id"],
                    "teacherName": teacher["name"],
                    "teacherAbbr": teacher["abbreviation"],
                    "sharing": "shared" if len(teacher_abbrs) > 1 else "single",
                }
            )
        if options:
            manual[(section_name, subject_name)] = options

    return manual


def build_subject_options(
    section_name: str,
    display: str,
    period_teacher_ids: Sequence[str],
    section_teacher_subjects: Dict[Tuple[str, str], List[dict]],
    section_subject_teachers: Dict[Tuple[str, str], List[dict]],
    section_teacher_presence: Dict[str, Set[str]],
    manual_subject_assignments: Dict[Tuple[str, str], List[dict]],
) -> List[dict]:
    compatible = compatible_subject_names(display)
    if not compatible:
        canonical = canonical_subject_name(display)
        compatible = [canonical] if canonical else []

    manual_options: List[dict] = []
    for subject_name in compatible:
        manual_options.extend(manual_subject_assignments.get((section_name, subject_name), []))
    if manual_options:
        return manual_options

    options: List[dict] = []
    seen_option_keys: Set[Tuple[str, str]] = set()

    candidate_teacher_ids = list(period_teacher_ids) if period_teacher_ids else list(section_teacher_presence.get(section_name, set()))
    for teacher_id in candidate_teacher_ids:
        for candidate in section_teacher_subjects.get((section_name, teacher_id), []):
            if compatible and candidate["subjectName"] not in compatible:
                continue
            key = (candidate["teacherId"], candidate["subjectId"])
            if key in seen_option_keys:
                continue
            seen_option_keys.add(key)
            options.append(
                {
                    "subjectId": candidate["subjectId"],
                    "subjectName": candidate["subjectName"],
                    "subjectCode": candidate["subjectCode"],
                    "teacherId": candidate["teacherId"],
                    "teacherName": candidate["teacherName"],
                    "teacherAbbreviation": candidate["teacherAbbr"],
                    "sharing": "shared" if period_teacher_ids else "grouped",
                }
            )

    if options or not compatible:
        return options

    for subject_name in compatible:
        for candidate in section_subject_teachers.get((section_name, subject_name), []):
            key = (candidate["teacherId"], candidate["subjectId"])
            if key in seen_option_keys:
                continue
            seen_option_keys.add(key)
            options.append(
                {
                    "subjectId": candidate["subjectId"],
                    "subjectName": candidate["subjectName"],
                    "subjectCode": candidate["subjectCode"],
                    "teacherId": candidate["teacherId"],
                    "teacherName": candidate["teacherName"],
                    "teacherAbbreviation": candidate["teacherAbbr"],
                    "sharing": "grouped",
                }
            )

    return options


def import_timetable(db_path: Path, class_docx: Path, teacher_docx: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        ensure_manual_teachers(conn)
        conn.commit()
        data = load_tables(conn)
        manual_subject_assignments = build_manual_subject_assignments(data)
        class_blocks = parse_docx_blocks(class_docx)
        teacher_blocks = parse_docx_blocks(teacher_docx)

        teacher_slots = build_teacher_slot_map(
            teacher_blocks,
            data["teachers"],
            data["teachers_by_abbr"],
            data["valid_sections"],
        )
        teacher_section_presence = build_teacher_section_map(
            teacher_blocks,
            data["teachers"],
            data["teachers_by_abbr"],
            data["valid_sections"],
        )

        inserted_rows: List[dict] = []
        unresolved = 0
        resolved_teacher_slots = 0
        metadata_slots = 0

        current_heading = ""
        table_index = 0
        for kind, payload in class_blocks:
            if kind == "p":
                current_heading = payload  # type: ignore[assignment]
                continue

            table_index += 1
            if table_index < 5:
                continue

            section_name = extract_class_heading_section(current_heading, data["valid_sections"])
            if not section_name:
                continue

            section = data["sections_by_name"][section_name]
            rows = payload  # type: ignore[assignment]
            header = rows[0]
            junior_layout = len(header) >= 11
            period_cols = list(range(3, 11)) if junior_layout else list(range(1, 9))
            previous: List[str] = [""] * len(header)

            for row in rows[1:]:
                if len(row) < len(header):
                    row += [""] * (len(header) - len(row))

                day_key = row[0].strip().lower()[:3]
                if day_key not in DAY_KEYS:
                    continue

                for period_number, col_index in enumerate(period_cols, start=1):
                    raw_cell = row[col_index].strip()
                    if is_repeat_marker(raw_cell):
                        base = previous[col_index]
                        if "L" in norm_alpha(raw_cell) and "(L)" not in base:
                            raw_cell = f"{base} (L)" if base else base
                        else:
                            raw_cell = base
                    elif raw_cell == "-":
                        raw_cell = ""

                    if raw_cell:
                        previous[col_index] = raw_cell

                    display = normalize_display(raw_cell)
                    if not display:
                        continue

                    teacher_ids = sorted(teacher_slots.get((section_name, day_key, period_number), set()))
                    options = build_subject_options(
                        section_name,
                        display,
                        teacher_ids,
                        data["section_teacher_subjects"],
                        data["section_subject_teachers"],
                        teacher_section_presence,
                        manual_subject_assignments,
                    )

                    canonical_name = canonical_subject_name(display)
                    if not options and canonical_name:
                        fallback = data["section_subject_teachers"].get((section_name, canonical_name), [])
                        if len(fallback) == 1:
                            chosen = fallback[0]
                            options.append(
                                {
                                    "subjectId": chosen["subjectId"],
                                    "subjectName": chosen["subjectName"],
                                    "subjectCode": chosen["subjectCode"],
                                    "teacherId": chosen["teacherId"],
                                    "teacherName": chosen["teacherName"],
                                    "teacherAbbreviation": chosen["teacherAbbr"],
                                    "sharing": "single",
                                }
                            )

                    primary_option = options[0] if options else None
                    canonical_subject = (
                        data["subjects_by_name"].get(canonical_name) if canonical_name else None
                    )
                    subject_id = primary_option["subjectId"] if primary_option else (
                        canonical_subject["id"] if canonical_subject else None
                    )

                    is_lab = "(L)" in raw_cell.upper() or norm_alnum(display).startswith("LAB")
                    is_games = norm_alnum(display).startswith("GAME")
                    is_yoga = norm_alnum(display).startswith("YOGA")
                    is_library = norm_alnum(display).startswith("LIB")
                    is_innovation = norm_alnum(display).startswith("INNOV")
                    is_we = norm_alnum(display) == "WE"

                    needs_metadata = (
                        len(options) != 1
                        or subject_id is None
                        or display_differs_from_subject(display, primary_option or canonical_subject)
                    )
                    notes = encode_combined_metadata(display, options) if needs_metadata else None

                    if options:
                        resolved_teacher_slots += 1
                    else:
                        unresolved += 1
                    if notes:
                        metadata_slots += 1

                    inserted_rows.append(
                        {
                            "id": f"imp202627_{section_name}_{day_key}_{period_number}",
                            "sectionId": section["id"],
                            "dayId": data["days"][day_key],
                            "timeSlotId": data["time_slots"][period_number],
                            "subjectId": subject_id,
                            "teacherId": primary_option["teacherId"] if len(options) == 1 else None,
                            "labTeacherId": None,
                            "roomId": None,
                            "isLab": int(is_lab),
                            "isInnovation": int(is_innovation),
                            "isGames": int(is_games),
                            "isYoga": int(is_yoga),
                            "isLibrary": int(is_library),
                            "isWE": int(is_we),
                            "isMusic": 0,
                            "isArt": 0,
                            "isFiller": 0,
                            "manuallyEdited": 1,
                            "notes": notes,
                        }
                    )

        now = conn.execute("SELECT datetime('now')").fetchone()[0]
        conn.execute("BEGIN")
        conn.execute("DELETE FROM TimetableSlot")
        conn.executemany(
            """
            INSERT INTO TimetableSlot (
              id, sectionId, dayId, timeSlotId, subjectId, teacherId, labTeacherId, roomId,
              isLab, isInnovation, isGames, isYoga, isLibrary, isWE, isMusic, isArt,
              isFiller, manuallyEdited, notes, createdAt, updatedAt
            ) VALUES (
              :id, :sectionId, :dayId, :timeSlotId, :subjectId, :teacherId, :labTeacherId, :roomId,
              :isLab, :isInnovation, :isGames, :isYoga, :isLibrary, :isWE, :isMusic, :isArt,
              :isFiller, :manuallyEdited, :notes, :createdAt, :updatedAt
            )
            """,
            [dict(row, createdAt=now, updatedAt=now) for row in inserted_rows],
        )

        workload_map: Dict[str, Set[Tuple[str, str]]] = defaultdict(set)
        scheduled_pair_counts: Dict[Tuple[str, str, str], int] = defaultdict(int)
        for row in inserted_rows:
            teacher_ids: Set[str] = set()
            if row["teacherId"]:
                teacher_ids.add(row["teacherId"])
                if row["subjectId"]:
                    scheduled_pair_counts[(row["sectionId"], row["teacherId"], row["subjectId"])] += 1
            if row["notes"] and row["notes"].startswith(COMBINED_PREFIX):
                payload = row["notes"][len(COMBINED_PREFIX):]
                metadata = json.loads(payload)
                for option in metadata.get("options", []):
                    teacher_id = option.get("teacherId")
                    subject_id = option.get("subjectId")
                    if teacher_id:
                        teacher_ids.add(teacher_id)
                        if subject_id:
                            scheduled_pair_counts[(row["sectionId"], teacher_id, subject_id)] += 1
            for teacher_id in teacher_ids:
                workload_map[teacher_id].add((row["dayId"], row["timeSlotId"]))

        section_names_by_id = {row["id"]: row["name"] for row in data["sections_by_name"].values()}
        for (section_id, teacher_id, subject_id), count in scheduled_pair_counts.items():
            section_name = section_names_by_id[section_id]
            key = (section_name, teacher_id, subject_id)
            if key in data["teacher_subject_keys"]:
                continue
            conn.execute(
                """
                INSERT INTO TeacherSubject (
                  id, teacherId, subjectId, sectionId, periodsPerWeek, isLabAssignment, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (
                    f"impasgn_{section_id}_{teacher_id}_{subject_id}",
                    teacher_id,
                    subject_id,
                    section_id,
                    count,
                    now,
                    now,
                ),
            )

        conn.execute("UPDATE Teacher SET currentWorkload = 0")
        conn.executemany(
            "UPDATE Teacher SET currentWorkload = ? WHERE id = ?",
            [(len(slots), teacher_id) for teacher_id, slots in workload_map.items()],
        )
        conn.commit()

        print(f"Imported {len(inserted_rows)} timetable slots into {db_path}")
        print(f"Resolved teacher coverage for {resolved_teacher_slots} slots")
        print(f"Encoded display/combined metadata for {metadata_slots} slots")
        print(f"Left {unresolved} slots without a resolved teacher assignment")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    db_path = root / "prisma" / "dev.db"
    class_docx = root / "CT 2026-27.docx"
    teacher_docx = root / "TeachersTime 2026-27.docx"

    missing = [str(path) for path in (db_path, class_docx, teacher_docx) if not path.exists()]
    if missing:
        print("Missing required files:")
        for item in missing:
            print(f"  - {item}")
        return 1

    import_timetable(db_path, class_docx, teacher_docx)
    return 0


if __name__ == "__main__":
    sys.exit(main())
