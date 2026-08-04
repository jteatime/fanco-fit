# Deload Week — Design

**Date:** 2026-08-03
**Status:** Approved, ready for implementation planning
**Applies to:** both `index.html` (A / Alicia) and `j.html` (J / Franco)

## What a deload week is

A planned *recovery* week inside a training cycle. You still train, but deliberately
lighter: fewer sets, fewer reps, lower weight, sometimes easier movements. The numbers
go down **on purpose**.

That is the whole design constraint. The app currently treats "less volume than last
week" as a regression — red dots, broken star streaks, lost wins, a sunken volume bar,
and rep targets that quietly poison the *following* week. A deload week must be invisible
to every one of those systems while still being fully logged.

## Scope

Three things:

1. A per-week deload flag, set when planning the cycle.
2. A week-scoped exercise list that does not leak into the rest of the cycle.
3. Every comparison and aggregation path taught to skip deload sessions.

Explicitly **out of scope:** per-week variation between two deload weeks in one cycle;
auto-scheduling deloads; percentage-of-1RM load prescription.

## Data model

Two new fields on the single JSON blob:

```js
deloadWeeks: [],    // 0-based week indices. [3] = week 4.
deloadPlan:  {},    // { [day]: [ {id,name,icon,targetSets,repGoal,variants,activeVariant}, … ] }
```

`deloadPlan` is **keyed by day only** — one deload template shared by every deload week in
the cycle. Rejected alternatives:

- **Per-week plans** (`deloadPlans["4|Wednesday"]`) — doubles setup work, and the keys
  point at stale week indices after `Start new cycle`.
- **A `deloadOnly` flag on `data.exercises`** — pollutes the one array that
  `buildSheetRows`, the cycle rollover and progress history all iterate. That is precisely
  the "carries over" leak this feature must not have.

Keeping the plan in a separate object makes leakage *structurally* impossible: no existing
code path can see a deload exercise unless it is changed to look.

### Seeding

The first time any week is flagged as deload, `deloadPlan` is seeded from the current
program: for each day in `DAYS`, copy `data.exercises.filter(e => e.day === day)` with
`targetSets` halved (`Math.max(1, Math.ceil(n / 2))`). A 6-set day becomes 3.

Copied exercises **keep their original `id`**, so `lastEntryFor` still resolves the
"last heavy" reference line. Deload-only additions get a fresh `slug()` id like any new
exercise.

A day already present in `deloadPlan` is never re-seeded, so editing is safe.

### Lifecycle

- Un-flagging a week deletes neither the plan nor any logged session. Re-flag and
  everything is still there.
- `Start new cycle` carries both fields forward. `deloadWeeks` is clipped to the new
  `cycleWeeks`.
- Load-path migration, same shape as the existing `if (!parsed.theme)` block:
  `if (!parsed.deloadWeeks) parsed.deloadWeeks = []; if (!parsed.deloadPlan) parsed.deloadPlan = {};`
- Added to `buildSeed` / `freshSeed` / `seedJ` in both files.

## New helpers

Next to `weekOfCycle` (index.html:400):

```js
const isDeloadWeek = (data, w) => (data.deloadWeeks || []).includes(w);
const isDeloadSess = (data, s) => isDeloadWeek(data, weekOfCycle(data, s.date));
const exListFor = (data, day, w) =>
  isDeloadWeek(data, w)
    ? ((data.deloadPlan || {})[day] || [])
    : data.exercises.filter((e) => e.day === day);
```

`exListFor` replaces the inline filter at `TodayView` (index.html:1177).

## Exclusion map

Line numbers are `index.html`; `j.html` differs by ~100 lines.

| Line | Function | Change |
|---|---|---|
| 418 | `lastEntryFor` | `continue` past deload sessions. This single edit fixes rep targets, green/red set coloring, the cycle-rollover `prev` field, **and** supplies the deload card's "last heavy" reference for free |
| 561 | `dayWeekStatus` | in a deload week, return `"deload"` when a session exists; the prev-week walk-back loop skips deload weeks |
| 1282 | `fireCelebration` record check | prev-week walk-back skips deload weeks; `record = false` outright in a deload week |
| 1288 | finale recap | deload sessions dropped from the `inCycle` volume total; the wins loop skips deload weeks |
| 1587 | `StatStrip` wins | deload sessions filtered out before the pairwise volume compare |
| 1626 | `TrendCard` | deload weeks **kept** as chart points, tagged `deload: true` → muted dot + `☾` axis label; excluded from any cycle sum. Applies to both `scope: "all"` (weekly points) and `scope: "day"` (per-session points) |
| 1499 | `LineChart` | a point with `deload: true` draws its dot in `T.muted` instead of the series color. Shared with the bodyweight and duration charts, which never set the field |
| 855, 868, 890 | `ExerciseCard` variant controls | must mutate `deloadPlan[day]` rather than `d.exercises` during a deload week — plan entries keep the program's ids, so writing to `d.exercises` would silently edit the real program |
| 1799 | `CycleGrid` | deload rows get a ☾ row label and the moon glyph per cell |
| 447 | `buildSheetRows` | deload weeks export with a `Week 5 (deload)` header; per-day rows union in `deloadPlan[day]` so deload-only movements are not silently dropped from the CSV |
| 1177 | `TodayView` | `exList` → `exListFor(data, day, wIdx)` |
| 1486 | `currentStreak` | **unchanged** — you trained, the streak stands |
| — | connected notes | **unchanged** — see Celebrations below |

`daySessionIn` (411) is deliberately **not** changed: `TodayView` needs it to find the
deload session itself. All guarding happens in its callers.

## Celebrations

A deload day's celebration is **identical to any other day's**. `fireCelebration`'s message
selection is not touched:

1. A pending connected note from the partner, dated on or before the session, delivers as
   it does today — `{name}` substitution, `from: PARTNER_NAME` tag, `deliverNote()` ack.
2. With no note waiting, it falls through to that file's own `CELEBRATIONS` array.

There is **no** `DELOAD_LINES` array. Neither `CELEBRATIONS` array is read, edited, or
copied between files (Golden Rule 2 holds).

The only deload-specific change in this area is `record = false`, which suppresses the gold
confetti and `NEW WEEKLY RECORD` banner — that is a volume comparison, not a message.

## UI

### Manage → Cycle

Below the existing `− 8 wk +` row:

```
Deload weeks
 1   2   3  (4)  5   6   7  (8)
             ☾           ☾

Lighter recovery weeks. Kept out of volume
totals, records, streaks and rep targets.
```

Chips run `1…cycleWeeks`. Tapping toggles membership in `deloadWeeks`; the first toggle
seeds `deloadPlan`.

### Manage → Schedule

A two-state switch above the existing day cards:

```
Schedule        [ Normal ]  [ ☾ Deload ]
```

The existing per-day editor (index.html:2468–2543) is **parameterized, not duplicated** —
same rename / reorder / planned-sets / delete / add controls, with the list source and all
mutation targets switched between `d.exercises` and `d.deloadPlan[day]`. The Deload tab is
only shown when `deloadWeeks` is non-empty.

Emptying a day's deload plan means no workout that day that week.

### Today view

```
 ‹   Cycle 2 · Week 4   ›

Wednesday · Nov 12
Cycle 2 · Week 4 · ☾ deload · today
──────────────────────────────────────
 🦵 Leg Press                       ›
    last heavy (wk 3): 100 × 10        ← grey, reference only
    1   [ 60 ] × [ 12 ]                ← no color
    2   [ 60 ] × [ 12 ]                ← no color
```

- Header gains a `· ☾ deload` segment.
- `ExerciseCard` keeps its existing "last time" line, now sourced from the last
  *non-deload* session (free, via the `lastEntryFor` change).
- `SetRow` receives `compareSet = undefined` in a deload week → no `target` placeholder, no
  green/red. Placeholders fall back to the program `repGoal`.

An earlier draft also called for a muted moon rail on each card's edge. **Dropped** — the
week is already marked in the Today header, the day pills, the heatmap and the chart, so a
fourth decorative marker inside every card is noise, and it would mean editing the shared
`.ll-card` root for cosmetics alone.

### Day pills & heatmap

New `"deload"` status in `dayWeekStatus` / `DayStatusIcon`, rendered as a muted ☾.

```
Normal week   Mon ★   Tue ★   Wed ●   Fri ★
Deload week   Mon ☾   Tue ☾   Wed ☾   Fri ○
```

Never a star, never a red dot. The semantic colors (Golden Rule 4) are untouched because a
deload day never enters the compare path that produces them.

## Edge cases

- **Exercise removed from the deload plan after it was logged.** The session entry is not
  deleted; the card simply stops rendering. Re-adding the exercise brings it back. Accepted.
- **Deload day with an empty plan.** No exercises, so no Start/Finish button — reads as a
  rest day. `upcomingWorkoutDates` (connected-notes composer) may still offer that date as a
  workout chip; a note sent to it rolls forward to the next finished session, which is the
  existing undelivered-note behavior. Accepted.
- **Deload week is the final week of the cycle.** The finale still fires on the last
  scheduled day, but its volume total and win count exclude the deload week.
- **First cycle with no prior heavy week.** The "last heavy" line is simply absent, as it is
  today for a brand-new exercise.

## Version differences

Nothing in this feature is version-specific. Both files get identical logic. The two files
continue to differ only in the ways CLAUDE.md's table already records — `deloadPlan` seeds
from each file's own `data.exercises`, so A and J naturally get different deload plans
without any per-file code.

## Verification

Both files must compile clean before commit:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');fs.writeFileSync('/tmp/a.jsx',h.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/)[1])" && npx --yes esbuild /tmp/a.jsx --loader:.jsx=jsx --outfile=/dev/null
node -e "const fs=require('fs');const h=fs.readFileSync('j.html','utf8');fs.writeFileSync('/tmp/j.jsx',h.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/)[1])" && npx --yes esbuild /tmp/j.jsx --loader:.jsx=jsx --outfile=/dev/null
```

Manual pass on `python3 -m http.server`, for each file:

1. Flag week N deload in Manage → Cycle; confirm the Deload tab appears and is seeded with
   halved set counts.
2. Edit the deload plan; confirm Manage → Schedule → Normal is unchanged.
3. Log a light session in week N; confirm no green/red, no rep target, "last heavy" line
   present.
4. Finish it; confirm ☾ on the pill and heatmap, no confetti, and that the celebration
   message is a normal one (or a pending partner note).
5. Open week N+1; confirm rep targets compare against week N−1, not the deload.
6. Progress: deload bar muted with ☾, cycle total and Wins exclude it, Streak includes it.
7. Export CSV; confirm the deload week is labeled and its exercises present.
8. Un-flag week N; confirm the logged session and the plan both survive.
