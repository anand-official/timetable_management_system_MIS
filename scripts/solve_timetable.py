#!/usr/bin/env python3
"""
Timetable scheduler using Google OR-Tools CP-SAT solver.

All TeacherSubject assignments are scheduled exactly (periodsPerWeek slots each)
while satisfying:
  - No teacher double-booked in the same slot (except W.E./Games shared activities)
  - No section double-booked in the same slot
  - Lab/double-period subjects placed in consecutive pairs
  - Period 1 never used for lab, library, games, yoga, or W.E. subjects
  - Max 6 regular periods per teacher per day
  - No 4+ consecutive periods for any teacher

Usage:
    python3 solve_timetable.py <input.json> <output.json>

Install:
    pip install ortools
"""

import json
import os
import sys
from collections import defaultdict
from ortools.sat.python import cp_model

# Subjects where the same teacher can run multiple sections simultaneously
SHARED_SLOT_SUBJECTS = frozenset(['Music', 'Dance', 'Art', 'Work Experience', 'Games', 'Yoga'])

# Subjects banned from period 1
NO_PERIOD_1_SUBJECTS = frozenset(['Library', 'Games', 'Yoga', 'Music', 'Dance', 'Art', 'Work Experience'])

MAX_PERIODS_PER_DAY = 6


def solve(data: dict) -> dict:
    model = cp_model.CpModel()

    sections    = data['sections']
    days        = data['days']
    time_slots  = sorted(data['timeSlots'], key=lambda t: t['periodNumber'])
    assignments = data['assignments']
    subject_map = {s['id']: s for s in data['subjects']}

    num_days    = len(days)
    num_periods = len(time_slots)
    period_nums = [t['periodNumber'] for t in time_slots]

    # ── Decision variables ─────────────────────────────────────────────────────
    # x[(k, d, p)] = 1  iff  assignment[k] is scheduled on day d at period p
    x = {}
    for k in range(len(assignments)):
        for d in range(num_days):
            for p in range(num_periods):
                x[(k, d, p)] = model.new_bool_var(f'x_{k}_{d}_{p}')

    # ── Helper ─────────────────────────────────────────────────────────────────
    def consecutive(p1: int, p2: int) -> bool:
        return period_nums[p2] == period_nums[p1] + 1

    period1_idx = next((i for i, t in enumerate(time_slots) if t['periodNumber'] == 1), None)

    # ── C1: Each assignment scheduled exactly periodsPerWeek times ─────────────
    for k, asgn in enumerate(assignments):
        model.add(
            sum(x[(k, d, p)] for d in range(num_days) for p in range(num_periods))
            == asgn['periodsPerWeek']
        )

    # ── C2: Lab / double-period subjects must occur in consecutive pairs ────────
    dp = {}  # dp[(k, d, p)] = 1 means this is the first slot of a consecutive pair
    for k, asgn in enumerate(assignments):
        subj = subject_map.get(asgn['subjectId'], {})
        if not (subj.get('isDoublePeriod') or subj.get('requiresLab')):
            continue

        num_pairs = asgn['periodsPerWeek'] // 2
        if num_pairs == 0:
            continue

        pair_vars = []
        for d in range(num_days):
            for p in range(num_periods - 1):
                if consecutive(p, p + 1):
                    v = model.new_bool_var(f'dp_{k}_{d}_{p}')
                    dp[(k, d, p)] = v
                    pair_vars.append(v)

        # Exactly num_pairs pairs per week
        model.add(sum(pair_vars) == num_pairs)

        # dp[(k,d,p)] = 1 → x[(k,d,p)] = 1  AND  x[(k,d,p+1)] = 1
        for (kk, d, p), dv in dp.items():
            if kk != k:
                continue
            model.add(x[(k, d, p)] >= dv)
            model.add(x[(k, d, p + 1)] >= dv)

        # Every occupied slot must belong to exactly one pair
        for d in range(num_days):
            for p in range(num_periods):
                covers = []
                if (k, d, p) in dp:
                    covers.append(dp[(k, d, p)])         # this slot is the FIRST
                if p > 0 and (k, d, p - 1) in dp:
                    covers.append(dp[(k, d, p - 1)])     # this slot is the SECOND
                if covers:
                    # x[(k,d,p)] must equal the sum of covering pairs (exactly one cover)
                    model.add(x[(k, d, p)] == sum(covers))

    # ── C3: At most one assignment per section per slot ─────────────────────────
    sec_asgn_map = defaultdict(list)
    for k, asgn in enumerate(assignments):
        sec_asgn_map[asgn['sectionId']].append(k)

    for s_id, ks in sec_asgn_map.items():
        for d in range(num_days):
            for p in range(num_periods):
                model.add_at_most_one(x[(k, d, p)] for k in ks)

    # ── C4: Teacher conflict — at most one regular assignment per slot ──────────
    teacher_regular = defaultdict(list)
    for k, asgn in enumerate(assignments):
        name = subject_map.get(asgn['subjectId'], {}).get('name', '')
        if name not in SHARED_SLOT_SUBJECTS:
            teacher_regular[asgn['teacherId']].append(k)

    for t_id, ks in teacher_regular.items():
        if len(ks) < 2:
            continue
        for d in range(num_days):
            for p in range(num_periods):
                model.add_at_most_one(x[(k, d, p)] for k in ks)

    # ── C5: Max MAX_PERIODS_PER_DAY regular periods per teacher per day ─────────
    teacher_all = defaultdict(list)
    for k, asgn in enumerate(assignments):
        teacher_all[asgn['teacherId']].append(k)

    for t_id, ks in teacher_all.items():
        names = {subject_map.get(assignments[k]['subjectId'], {}).get('name', '') for k in ks}
        if names.issubset(SHARED_SLOT_SUBJECTS):
            continue  # W.E./Games teachers teach multiple sections simultaneously
        for d in range(num_days):
            model.add(
                sum(x[(k, d, p)] for k in ks for p in range(num_periods))
                <= MAX_PERIODS_PER_DAY
            )

    # ── C6: Period 1 restrictions ───────────────────────────────────────────────
    if period1_idx is not None:
        for k, asgn in enumerate(assignments):
            subj = subject_map.get(asgn['subjectId'], {})
            if subj.get('requiresLab') or subj.get('name', '') in NO_PERIOD_1_SUBJECTS:
                for d in range(num_days):
                    model.add(x[(k, d, period1_idx)] == 0)

    # ── C7: No 4 consecutive periods for any teacher ────────────────────────────
    for t_id, ks in teacher_regular.items():
        if not ks:
            continue
        for d in range(num_days):
            for start in range(num_periods - 3):
                if (consecutive(start, start + 1) and
                        consecutive(start + 1, start + 2) and
                        consecutive(start + 2, start + 3)):
                    model.add(
                        sum(x[(k, d, p)] for k in ks for p in range(start, start + 4))
                        <= 3
                    )

    # ── C8: Same subject at most once per section per day (core subjects only) ──
    sec_subj_asgns = defaultdict(list)
    for k, asgn in enumerate(assignments):
        subj = subject_map.get(asgn['subjectId'], {})
        if subj.get('category', '') not in ('Activity',):
            sec_subj_asgns[(asgn['sectionId'], asgn['subjectId'])].append(k)

    for (s_id, sub_id), ks in sec_subj_asgns.items():
        for d in range(num_days):
            model.add(
                sum(x[(k, d, p)] for k in ks for p in range(num_periods))
                <= 1
            )

    # ── Solve ───────────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60.0
    solver.parameters.num_workers = min(os.cpu_count() or 1, 8)
    solver.parameters.log_search_progress = False

    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            'success': False,
            'slots': [],
            'message': f'No solution found (status={solver.status_name(status)})',
            'wallTime': solver.wall_time,
        }

    # ── Extract solution ────────────────────────────────────────────────────────
    slots = []
    for k, asgn in enumerate(assignments):
        subj = subject_map.get(asgn['subjectId'], {})
        subj_name = subj.get('name', '')
        for d, day in enumerate(days):
            for p, ts in enumerate(time_slots):
                if solver.value(x[(k, d, p)]):
                    slots.append({
                        'sectionId':    asgn['sectionId'],
                        'dayId':        day['id'],
                        'timeSlotId':   ts['id'],
                        'subjectId':    asgn['subjectId'],
                        'teacherId':    asgn['teacherId'],
                        'isLab':        bool(subj.get('requiresLab')),
                        'isGames':      subj_name == 'Games',
                        'isYoga':       subj_name == 'Yoga',
                        'isLibrary':    subj_name == 'Library',
                        'isWE':         subj_name in ('Music', 'Dance', 'Art', 'Work Experience'),
                        'isMusic':      subj_name == 'Music',
                        'isArt':        subj_name == 'Art',
                        'isInnovation': subj_name == 'Innovation',
                    })

    return {
        'success': True,
        'slots': slots,
        'message': f'Solved ({solver.status_name(status)}): {len(slots)} slots in {solver.wall_time:.1f}s',
        'wallTime': solver.wall_time,
    }


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print('Usage: python3 solve_timetable.py <input.json> <output.json>', file=sys.stderr)
        sys.exit(1)

    input_path  = sys.argv[1]
    output_path = sys.argv[2]

    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    result = solve(data)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f)

    sys.exit(0 if result['success'] else 1)
