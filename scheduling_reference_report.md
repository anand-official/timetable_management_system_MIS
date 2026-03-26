# Scheduling Reference Report

Source reviewed:
- `C:\Users\anand\Desktop\bca69962-06bd-42ac-93f8-d6fe8b2ccc59\38a8daa6-aaf7-4280-b435-161ac25df82d\CT 2025-26 (From 26th june 2025) (1).md`
- `C:\Users\anand\Desktop\bca69962-06bd-42ac-93f8-d6fe8b2ccc59\ae70b2e9-f341-47cf-af42-dd22045f0cc0\TeachersTime 2025-26 (1).md`
- `C:\Users\anand\Desktop\bca69962-06bd-42ac-93f8-d6fe8b2ccc59\f5ef5347-7eb5-4401-9cfa-4aef1e2f323e\New work load year 2025-26 (Sr.).md`

## What the reference school is doing

The real timetable is not built from raw subject counts alone. It uses a fixed 6-day x 8-period weekly grid and then adapts the subject demand into that grid with a few recurring patterns:

1. Core subjects keep stable section ownership.
   One teacher stays with the same section for the same subject across the whole week. This is especially clear for Mathematics, English, Social Studies, Physics, Chemistry, Biology, Accounts, Economics, and Business Studies.

2. Lower grades use repeatable column patterns.
   Classes VI-VIII repeatedly place the same core subjects in the same broad period bands across the week, then rotate Games, Library, Innovation, Yoga, Aerobics, and Work Experience into lighter slots.

3. Languages and elective blocks are grouped.
   The class timetables often show `2nd(L)` and `3rd(L)` instead of a single concrete subject name. That means the grid is reserving a language block, while the teacher-side schedule decides who actually handles the subgroup.

4. IX-X switch from generic junior blocks to explicit senior subjects.
   IX uses separate Physics, Chemistry, and Biology slots instead of a single Science bucket. X introduces Economics, Geography, Home Science, and similar option-style periods.

5. XI-XII use composite option blocks.
   Senior classes use combined blocks such as `M/C/H`, `Comp/Eco`, `IP/HSC`, and science lab pairs. These are not single-teacher, single-subject section cells in the strict sense; they are coordinated option blocks.

6. Labs are scheduled as true constrained resources.
   Physics, Chemistry, Biology, and Computer practicals are placed in lab-compatible slots, often as paired or consecutive blocks.

7. Activities are pushed away from the heaviest academic periods.
   Games, Library, Innovation, Yoga, and Aerobics are mostly placed later in the day, while heavy academic subjects are front-loaded.

## Practical implication for this codebase

The current schema stores one `subjectId` and one `teacherId` per section-period. That means it can model:
- stable section-subject ownership
- lab constraints
- shared supervision subjects like Games and Library

It cannot model composite subgroup blocks exactly, because a real block like `2nd(L)` or `M/C/H` can involve multiple teachers or multiple option subjects at the same section-period.

So the implementation used here is an approximation:
- VI-X now use a reference-driven weekly demand template that fits the real 48-slot week
- generic buckets such as `2nd Language`, `3rd Language`, `Science`, and `Work Experience` are resolved onto one real subject already present in the section data
- if a required section-subject teacher is missing, the generator synthesizes one in memory from `teachableGrades`, department-subject matching, and current projected workload
- XI-XII remain DB-driven, because their real timetable relies heavily on composite option blocks that the current schema does not represent natively

## Reference-derived weekly demand used by the generator

### VI-VIII
- `2nd Language`: 6
- `3rd Language`: 4
- `English`: 6
- `Mathematics`: 8
- `Science`: 6
- `Social Studies`: 6
- `Computer Science`: 3
- `Games`: 3
- `Work Experience`: 2
- `Library`: 1
- `Innovation`: 1
- `Yoga`: 1
- `Aerobics`: 1

### IX
- `2nd Language`: 6
- `English`: 7
- `Mathematics`: 8
- `Physics`: 3
- `Chemistry`: 3
- `Biology`: 3
- `Social Studies`: 8
- `Computer Science`: 3
- `Games`: 3
- `Work Experience`: 2
- `Library`: 1
- `Innovation`: 1

### X
- `2nd Language`: 5
- `English`: 6
- `Mathematics`: 9
- `Physics`: 4
- `Chemistry`: 4
- `Biology`: 4
- `Geography`: 2
- `Economics`: 2
- `Home Science`: 3
- `Computer Science`: 3
- `Games`: 3
- `Work Experience`: 1
- `Library`: 1
- `Innovation`: 1

## Remaining limitation

If you want exact parity with the real school timetable for language splits and senior option blocks, the data model has to support multiple teachers and/or multiple logical subjects inside a single section-period cell. The current fix improves the generator substantially, but it still collapses those composite blocks to one representative section subject because that is all the schema can store.
