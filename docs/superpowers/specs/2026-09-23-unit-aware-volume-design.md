# Unit-aware volume, and navigating the Log across cycles — design

**Date:** 2026-09-23
**Status:** approved design, not yet implemented
**Applies to:** both `index.html` (A / Alicia) and `j.html` (J / Franco)

## The problem

Two separate defects, reported together, with a dependency between them.

**1. Volume mixes kg and lb silently.** A set stores a bare number in `w`;
the unit lives in a single global `data.unit`. Franco logged cycle 2 in
Colombia in kg and started cycle 3 in Mexico in lb, so `volumeOf` — which is
`Σ w × r` with no notion of unit — now adds 70 (kg) to 180 (lb) and calls the
result one quantity. Every figure built on it is wrong across the boundary:
all-time volume, the Trends chart, day-over-day verdicts, records, the
finale, most-improved, and `SetRow`'s "beat last week" target.

**2. The Log tab cannot navigate before the current cycle.**
`TodayView` computes `wIdx = Math.min(maxWeek, Math.max(0, curWeek + weekOffset))`
— a week index *within the live cycle*, floored at 0 — and disables `‹` at
`wIdx <= 0`. Cycle 2's sessions are unreachable from the Log tab even though
the Progress tab can page back to them.

(2) depends on (1): navigating into cycle 2 is only useful once those weeks
display in the right unit.

## Evidence establishing the unit boundary

Confirmed against the live cloud blob rather than assumed:

| Exercise | Sep 15 (cycle 2) | Sep 22 (cycle 3) | check |
|---|---|---|---|
| Incline Bench | 30 | 65 | 30 kg = 66 lb |
| Lateral Raise | 8 | 20 | 8 kg = 17.6 lb |
| Leg Press | 70 | 180 | 70 kg = 154 lb, so 180 is progress |

The unit change coincides exactly with the cycle 2 → 3 boundary
(cycle 2: 2026-06-15…2026-09-21, cycle 3 from 2026-09-22). Of 1,550 sets,
**1,486 are kg and 64 are lb**, and none carries a unit stamp. Alicia's blob
never switched: `unit: "lb"`, max 360, mean 117.5 — already lb throughout.

Franco confirmed this reading. The migration therefore needs no inference.

## Decisions taken

| Question | Decision |
|---|---|
| Approach | Stamp each set's unit; make the math canonical. Never rewrite a logged `w`. |
| Canonical unit | **kg**, `1 lb = 0.45359237 kg` |
| Volume display | The user's **current** unit, converted, so the all-time line is continuous |
| Historical set display | **Converted** to the current unit in read-only views |
| Editable inputs | **Native stored value**, not converted — see Display below |
| Sequencing | Phase 1 = unit awareness. Phase 2 = Log navigation. |

Rejected: rewriting every stored `w` into one unit (simplest math, but it
destroys the number actually read off the machine, and has to be redone on
every move); keeping cycles unit-siloed with no cross-unit comparison (honest
but gives up the all-time view, which is the thing asked for).

## Phase 1 — unit-aware volume

### Data model

Two additive fields. Nothing is removed; no logged `w` is ever rewritten.

```
set.u: "kg" | "lb"      // the unit this set was logged in
cycleHistory[i].unit    // the unit that finished cycle was logged in
```

The live cycle's unit is the existing `data.unit`. `bwUnit` already governs
bodyweight separately and is untouched.

`cycleHistory[i].unit` exists for one reason beyond the migration: once Phase
2 lands, a set created while viewing a past cycle's week needs a correct
default, and the live `data.unit` would be the wrong one.

### Migration (one-time, idempotent)

In the load `useEffect`, after `migrateCycleHistory`:

1. Give each `cycleHistory` entry a `unit`, defaulting to **the build's seed
   unit** — `kg` for `j.html`, `lb` for `index.html` (`freshSeed` sets
   `d.unit = "lb"`). Per the evidence above this is exactly right for both
   installs, with no guessing.
2. For each session, resolve its cycle with
   `viewFor(cycleViews(data), session.date)` and stamp every set that has a
   weight with that cycle's unit. Sets in the live cycle take `data.unit`.
3. Stamp `ex.prevU` the same way. `prev` is written at rollover from the
   outgoing cycle's top weight, so its unit is that cycle's unit.
4. Skip any set that already has `u`, so re-running is a no-op.

A set with no weight (an empty planned row) is left unstamped; it gets its
unit when a weight is first typed. **The unit it takes is the unit of the
cycle the set's session belongs to, not `data.unit`** — otherwise, once Phase
2 allows logging into a cycle-2 week, a correction typed there would be
stamped lb and sit inside a kg cycle. `cycleHistory[i].unit` exists for
exactly this case.

### Math

`volumeOf` is the single conversion point — `scoreOf` delegates to it, and
`isBodyweight` depends on it:

```js
const KG_PER_LB = 0.45359237;
const kgOf = (s) => (s.u === "lb" ? num(s.w) * KG_PER_LB : num(s.w));
const volumeOf = (sets) => sets.reduce((a, s) => a + (s.skipped ? 0 : kgOf(s) * num(s.r)), 0);
```

An unstamped set falls through to `num(s.w)` — treated as kg. After the
migration only weightless sets are unstamped, so this cannot misread real
data, and it keeps `volumeOf` total for hand-edited blobs.

Because `scoreOf` delegates to `volumeOf`, every consumer becomes correct
with no signature change: `dayVolume`, `dayWeekStatus`, the heatmap verdicts,
records, the finale, most-improved, `lastEntryFor` comparisons, and
`TrendCard`'s volume series. `scoreOf`'s bodyweight fallback still returns a
rep count, which is unitless and unaffected.

**`SetRow`'s target** (`floor(lastVol / w) + 1`) must compute canonically and
then express the answer in the row's own unit, or a kg-era comparison would
hand an lb row a kg-scaled target.

### Display

- `fmtVol(n)` today is `Math.round(n).toLocaleString("en-US")` — a pure
  formatter with no unit notion. It becomes `fmtVol(kg, unit)`: converts
  canonical kg into `unit` and appends the label. **All six call sites must be
  updated**; a missed one silently prints kg where lb is meant, which is the
  same class of bug this phase exists to remove. The bodyweight branches at
  those sites print rep counts and stay unitless.
- `setsLine` converts each set into the current unit for read-only views:
  "last time" lines, the day drill-in, exercise history, the collapsed
  superset summary.
- **The editable weight input shows the set's native stored value.** This is
  the one deliberate inconsistency. Once Phase 2 allows navigating into a
  cycle-2 week, an input pre-filled with a converted `154` means any stray
  keystroke writes `154` as an lb value over a real 70 kg entry. An input is a
  direct handle on stored data, so it shows what is stored, and the card's
  column header names that unit (`WEIGHT (KG) × REPS`) when it differs from
  the current one. Read-only views still convert.

### CSV export

Grid cells keep each set's native value — the export is a record of what was
logged — so the sheet must say which unit those numbers are in.

**Corrected during implementation:** this originally specified one row per
cycle, omitted when all cycles shared a unit. That was wrong on both counts.
`buildSheetRows` computes weeks relative to `data.cycleStart`, so
archived-cycle sessions fall to negative week indices and appear in no grid
cell, and the download is named `franco-fit-cycle-<N>.csv` — the export is a
**single-cycle sheet**. Listing every cycle described data absent from the
file. The block is therefore scoped to the live cycle and emitted
unconditionally, since a reader of a bare number needs the unit whether or
not anything is mixed. A unit switch partway through the live cycle still
cannot be expressed, which is the same known gap `migrateUnits` documents.

## Phase 2 — Log navigation across cycles

`TodayView` currently indexes by week-within-the-live-cycle. It should
navigate by **date** and resolve which cycle that date falls in, reusing the
machinery Phase 1 of supersets already added.

- Derive the viewed week's date from `weekOffset` rather than clamping an
  index at 0, then resolve its cycle with `viewFor(cycleViews(data), date)`.
- Re-point the six consumers of `wIdx` at that resolved view:
  `daySessionIn` → `daySessionInView`, `cellDateFor(data.cycleStart, …)` →
  the view's start, `isDeloadWeek` → `isDeloadWeekIn`, `exListFor` →
  `exListForView`, `dayWeekStatus` → its view-scoped form, and the
  "Cycle N · Week M" label → the resolved cycle's name and week.
- The backward limit becomes the earliest cycle's start rather than 0;
  `‹` disables there.
- `Start Workout` and `Finish Workout` are already gated on
  `weekOffset === 0` and stay that way — navigating back is for reading and
  correcting, not for starting a workout in the past.

## Out of scope

- Rewriting stored `w` values into a single unit.
- Per-session or per-set unit *editing* UI. Stamping happens automatically;
  a wrong stamp is fixable by re-entering the weight.
- Bodyweight units (`bwUnit`) — already independent and already correct.
- Converting `weights` (bodyweight log) — it has its own unit field.
- **Cross-build blobs.** `migrateUnits` dates a pre-stamp blob's archived
  cycles from this build's `SEED_UNIT`, so pasting a JSON backup or entering
  a sync code from the OTHER build stamps its kg history as lb (or the
  reverse). Such a blob is already wrong to import — the two builds are
  different people's data — but the JSON backup is the only undo for this
  change, so the limitation is written down rather than assumed away. There
  is no detection and no guard.

## Testing

**Logic (Node, both files):**
- `kgOf` for kg, lb, unstamped, and skipped sets.
- `volumeOf` canonical across a mixed-unit set list; a pure-lb list equals
  the kg-converted expectation.
- Migration on a fixture shaped like the real blob: archived cycle stamped
  kg, live cycle lb, session counts matching; idempotent on a second run; an
  all-lb blob (Alicia's shape) stamped entirely lb; weightless sets left
  unstamped.
- `ex.prevU` stamped from the outgoing cycle.
- `SetRow`'s target computed canonically then expressed in the row's unit.

**Render:**
- `fmtVol` output carries a unit and reflects the current unit.
- `setsLine` converts a kg-era set while the current unit is lb.
- The editable input shows the native value, and the column header names the
  set's unit when it differs from the current one.

**Real Chrome:**
- All-time volume has no step at the cycle 2/3 boundary — the assertion that
  would have failed before this change.
- Switching unit in Manage re-scales displayed volume but leaves every stored
  `w` and `u` untouched.
- Phase 2: `‹` walks back past the current cycle's start into cycle 2, the
  label names cycle 2, that week's logged sets appear, and `Start Workout`
  stays hidden.

Both files must compile clean via the `esbuild` extraction in `CLAUDE.md`,
and the new code must be identical across them — units are not in the
intentional-differences table.

## Golden rules touched

- **Rule 5** (comparisons per exercise per machine): preserved and made
  *correct* — a cross-boundary comparison was previously comparing kg to lb.
- **Rule 3** (seed changes don't reach existing users): the work is a load-path
  migration, which is the sanctioned mechanism. It is idempotent.
- **Rule 4** (semantic colours): untouched. Verdicts change value, not meaning.
- **Rule 2** (never sync the differences table): the per-build seed unit is
  *read* by the migration and must not be homogenised.
- **Rule 1** (never change a `STORAGE_KEY`): untouched.
