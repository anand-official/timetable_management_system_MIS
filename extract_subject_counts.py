import pdfplumber
import re
import pandas as pd
from collections import defaultdict

# Path to your class timetable PDF
pdf_path = "upload/CT 2025-26 (From 26th june 2025) (1).pdf"

# Map of subject codes (as they appear) to canonical names
subject_map = {
    "Eng": "English",
    "Maths": "Mathematics",
    "Sci": "Science",
    "S.Sci": "Social Studies",
    "S.S.T": "Social Studies",
    "SST": "Social Studies",
    "S.St": "Social Studies",
    "Phy": "Physics",
    "Chem": "Chemistry",
    "Bio": "Biology",
    "Comp": "Computer Science",
    "IP": "Informatics Practices",
    "Eco": "Economics",
    "B.St": "Business Studies",
    "ACC": "Accountancy",
    "Acc": "Accountancy",
    "H/C": "Home Science",
    "WE": "Work Experience",
    "Lib": "Library",
    "Games": "Games",
    "Yoga": "Yoga",
    "Aerobic": "Aerobics",
    "Aerobics": "Aerobics",
    "Inn": "Innovation",
    "Innov": "Innovation",
    "2nd(L)": "2nd Language",
    "3rd(L)": "3rd Language",
    "2nd L": "2nd Language",
    "3rd L": "3rd Language",
    "Hindi": "2nd Language",
    "Sansk": "3rd Language",
    "Sans": "3rd Language",
    "French": "3rd Language",
    "M/C/H": "Maths/Chem/Home Sci",  # optional, for combined rows
    "P/C/B": "Physics/Chem/Bio",      # optional
    "I.P": "Informatics Practices",
    "H.SC": "Home Science",
    "Geo": "Geography",
    "Hist": "History",
    "B . St": "Business Studies"
}

section_counts = defaultdict(lambda: defaultdict(int))

with pdfplumber.open(pdf_path) as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if not text:
            continue
            
        # Look for class header like "Class: - VIA", "Class:- XII B"
        # Since it might be split across lines or spaces
        class_match = re.search(r"Class\s*:\s*-?\s*([A-Z0-9IVX]+\s*[A-Z]?)", text, re.IGNORECASE)
        if not class_match:
            continue
        section = class_match.group(1).upper().replace(" ", "")

        # Extract table from this page (might be multiple classes per page)
        table = page.extract_table()
        if not table:
            continue

        # The table layout varies. We'll scan each cell for subject codes.
        for row in table:
            if not row:
                continue
            # Each cell may contain multiple subject abbreviations separated by spaces or newlines.
            for cell in row:
                if not cell:
                    continue
                # Split by whitespace, punctuation, or known separators
                tokens = re.split(r'[\s,;\n]+', str(cell))
                for token in tokens:
                    token = token.strip()
                    if not token:
                        continue
                    # Remove trailing (L) or (l) indicators
                    clean_token = re.sub(r'\(L\)|\(l\)', '', token).strip()
                    
                    found = False
                    # Map to canonical subject name exactly
                    if clean_token in subject_map:
                        subj = subject_map[clean_token]
                        section_counts[section][subj] += 1
                        found = True
                    else:
                        # Try partial match (e.g., "2nd(L)" -> "2nd Language")
                        for code, name in subject_map.items():
                            if clean_token.startswith(code) or code.startswith(clean_token):
                                subj = name
                                section_counts[section][subj] += 1
                                found = True
                                break
                                
                    if not found and len(clean_token) > 2 and clean_token not in ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]:
                        pass

# Create DataFrame and save
rows = []
for section, subj_counts in section_counts.items():
    for subj, count in subj_counts.items():
        rows.append({"section": section, "subject": subj, "periodsPerWeek": count})

df = pd.DataFrame(rows)

# Normalise VI-X grades to have identical periods across sections
def get_base_class(sec):
    match = re.match(r"(VI{0,2}|IX|IV|V|X{1,2})", sec)
    if match:
        grade = match.group(1)
        # 11 and 12 remain section-specific
        if grade in ["XI", "XII"]:
            return sec
        return grade
    return sec

df['grade'] = df['section'].apply(get_base_class)

# For VI to X, take the maximum periods per subject across any sub-section parsed to account for OCR/pdfplumber misses
normalised_df = df.groupby(['grade', 'subject'])['periodsPerWeek'].max().reset_index()

# Generate the final rows by assigning the normalised class data back to standard sections (A, B, C, D) 
# Note: For XI and XII, the 'grade' maintains the specific section identity like 'XIA' or 'XIIDW'
final_rows = []
for _, row in normalised_df.iterrows():
    grade = row['grade']
    subj = row['subject']
    count = row['periodsPerWeek']
    
    if grade in ["VI", "VII", "VIII", "IX", "X"]:
        for section_letter in ["A", "B", "C", "D"]:
            final_rows.append({"section": f"{grade} {section_letter}", "subject": subj, "periodsPerWeek": count})
    else:
        # XI and XII formatting, insert space before last letter/word if needed
        sec_name = re.sub(r'(XI{0,2})(.*)', r'\1 \2', grade).strip()
        final_rows.append({"section": sec_name, "subject": subj, "periodsPerWeek": count})

final_df = pd.DataFrame(final_rows)
final_df = final_df.sort_values(by=['section', 'subject']).drop_duplicates()
final_df.to_csv("class_subject_periods.csv", index=False)
print("Saved unified dataset to class_subject_periods.csv")
