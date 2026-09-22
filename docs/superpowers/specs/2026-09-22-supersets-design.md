# Supersets — design

**Date:** 2026-09-22
**Status:** approved design, not yet implemented
**Applies to:** both `index.html` (A / Alicia) and `j.html` (J / Franco)

## Goal

Log a superset as one connected thing rather than two exercises that happen to
sit next to each other. Franco starts the next cycle using supersets, so the
Log tab has to support alternating sets, and Manage has to be able to declare
the pairing.

## Decisions taken

| Question | Decision |
|---|---|
| Log layout | **Round-interleaved.** One card; each round is a block containing every member's set for that round, in performance order. |
| Uneven set counts | **Rounds belong to the group.** All members share one round count. |
| Creating a pair | **Chain in the gap.** A `🔗 link` pill between adjacent exercises in Manage. |
| Marker | A chain (`🔗`) plus a left connector rail in the Log card, drawn in **neutral** chrome (see Colour below). |
| Delivery | Two phases; phase 1 is the whole usable feature. |

Rejected: bracketed-pair layout (pairing stays cosmetic — you'd still log 3 of A
then 3 of B), side-by-side columns (tap targets below comfortable size, breaks
with 3-digit weights and trisets), select-then-link mode (a mode to enter and
escape, for an advantage — pairing distant moves — that rarely applies).

## Data model

One optional field on an exercise:

```
ex.supersetId?: string    // exercises sharing this id form one group
```

That is the entire addition. `sessions` is untouched: entries stay keyed by
exercise id.

**Rounds are `targetSets`, kept in sync across members.** The group's rounds
stepper writes the same value to every member. Consequences:

- `ExerciseCard`'s `exTotal`, `TodayView`'s `totalSets`/`filledSets`,
  `seedDeloadPlan`'s halving and `buildSheetRows` need no changes — there is no
  second source of truth to drift.
- Golden Rule 5 holds automatically. Comparisons stay per exercise per machine
  via `lastEntryFor`; nothing merges volumes across a superset.
- The field is optional and absent means "not a superset", so **no migration is
  required** and older JSON backups restore cleanly.

**Invariant:** all members of a group share one `targetSets`. Enforced when
linking and by the group stepper. `rounds = max(member.targetSets)` is used when
reading, as a safety net for a hand-edited or legacy blob.

## Grouping

```js
groupedExercises(list)
  -> [{ kind: "single", ex } | { kind: "superset", id, rounds, members: [ex] }]
```

Group **by first appearance**, not by consecutive runs: a reorder that separated
two members would silently split a run-based group. Walk the day's list once;
each member attaches to its group's first slot.

Two safety nets:

- A group left with one member collapses to `{kind:"single"}`, so deleting half
  a pair cannot leave broken UI.
- `rounds` derives from `max` of the members' `targetSets`.

## Log tab

`TodayView`'s render loop becomes `groupedExercises(exList).map(...)`, dispatching
to a new `SupersetCard` or the existing `ExerciseCard`.

### `SupersetCard`

- Card with a chain accent and a `🔗 SUPERSET · N ROUNDS` tag; title is the member
  names joined with `+`. One `open` state for the group, matching `ExerciseCard`.
- A left connector rail runs the **full height of the card**, spanning all rounds,
  with a link notch beside each member row. It is the element that makes the
  members read as one thing, so it is continuous rather than per-round.
- Open state: for each round index `r` in `0..rounds-1`, a round block containing
  one labeled row per member, each rendering `SetRow` for set index `r`.
  - Round label: `Round r+1`, marked `✓` when complete, and `— now` in
    `T.blue` on the first incomplete round.
  - A round is complete when every member's set at that index has `r > 0` or
    `skipped`.
- Per-member delta and set count stay visible in the card, not hidden behind the
  overflow control.
- Per-member `⋯` expands that member's extras: machine/variant picker, swap,
  note, skip-all, extra set.
- A member's `extra` sets render after the round blocks as a labeled solo tail
  row — extras already sit outside the planned total, so they never create a
  round. This is also the escape hatch for a deliberately lopsided pair.
- Group strip colour follows the same semantics as `ExerciseCard`: incomplete,
  skipped, beating, down, tie.

### Colour

The superset chrome must **not** be amber. `pos` / `neg` / `amber` are semantic
(beat previous / down / tie-or-no-comparison) and Golden Rule 4 forbids
repurposing them; `blue` is reserved for today and the timer accent. The
mockups used amber and were wrong on this point.

The chain rail, group border and `🔗 SUPERSET` tag use neutral chrome —
`T.line` for the rail and border, `T.muted` for the tag — and the chain glyph
carries the meaning. Per-round `✓`, the `— now` marker and the member/group
strips keep the existing semantic colours unchanged, so a superset card still
reads green-beat / red-down exactly like a normal card.

### Reuse

`SetRow` is reused verbatim as a round cell, with `compareSet` taken from that
member's own `lastEntryFor(...)`. This preserves, with no new code:

- the "beat last week" placeholder target,
- per-set green/red against the same set index on the same machine,
- the weight cascade, which is per-entry and still cascades down that member's
  later rounds.

### The one refactor

`ExerciseCard` owns `ensureEntry`, `changeSet`, `addExtraSet`, the completion
math and the burst animation. `SupersetCard` needs all of it per member. Extract
a function:

```js
exerciseEntry(data, update, ex, sessionKey, isDeload)
  -> { entry, variant, lastSame, lastAny, sets, ensureEntry, changeSet,
       addExtraSet, setSkipAll, exTotal, exFilled, exComplete, delta, stripColor }
```

Named `exerciseEntry`, not `useExerciseEntry`, despite reading like a hook
extraction: it is deliberately called from inside `SupersetCard`'s
`members.map(...)`, once per member. A `use`-prefixed name would advertise
hook rules (stable call count/order) that this call site violates on purpose,
and would invite someone to add a `useState`/`useMemo` inside it later — which
would turn a stable-keyed card into a component with a variable-length hook
list and crash React. It contains no hooks and must stay that way; the name
says so up front. (Amended post-review — the design originally called this
`useExerciseEntry`; the controller ruled the name is incidental to the design
while the crash class it invites is real.)

The exact returned shape is illustrative — it must be whatever `ExerciseCard`
already derives, moved verbatim. The rule is that nothing in `ExerciseCard`'s
current behaviour changes; the hook is a cut-and-lift, not a redesign.

`ExerciseCard` consumes it; `SupersetCard` calls it once per member. This removes
duplication rather than adding it.

**This is the main risk in the build** — it touches the single-exercise logging
path used every day. The refactor must be strictly behaviour-preserving, and is
covered by a dedicated regression test (below) before the superset path is added.

## Manage tab

- A faint `🔗 link` pill renders in each gap between adjacent exercises in a
  day's list.
- Tapping a gap assigns a fresh `supersetId` to both neighbours and raises the
  lower `targetSets` to match the higher, with an inline confirmation
  (`Leg Curl raised 3 → 4 rounds to match`). Raising is preferred over dropping
  a planned set.
- Tapping a gap adjacent to an existing group adds that neighbour to the group,
  which yields trisets with no extra UI.
- A group renders as a chained block: `🔗 SUPERSET`, a rounds stepper writing
  `targetSets` to all members, `unlink`, and each member row with `✎` only. The
  per-member "planned sets" stepper is hidden, replaced by the group stepper.
- `↑ ↓` move the whole group: lift all members and reinsert them as a block.
- `unlink` deletes `supersetId` from every member, leaving their `targetSets`
  as-is.
- Deload weeks: linking edits `deloadPlan[day]` through the existing
  `mutListFor`. `seedDeloadPlan` carries `supersetId` through its `{...e}`
  spread, and halving is identical for all members, so they cannot desync.

## Progress tab and CSV export

Deliberately minimal — per-exercise history is the point of the Progress tab.

- Keep one card per exercise. Add a small `🔗` marker naming the partner move on
  the exercise card and in the day drill-in.
- `buildSheetRows` emits one row per exercise keyed by `ex.name`. Append a
  `🔗 superset with X` line to the existing `extras` sheet rather than
  restructuring the grid, so the exported spreadsheet layout is unchanged.

## Out of scope

- Rest timer changes. `RestTimer` is manual with local state and no coupling to
  set logging; there is nothing to wire.
- Superset-level volume, records or day comparisons. Comparisons stay per
  exercise per machine.
- Cross-day supersets.
- Drag-and-drop reordering.

## Phasing

**Phase 1 — the usable feature.** `supersetId`, `groupedExercises`,
`exerciseEntry` extraction, `SupersetCard`, Manage chain linking and the group
block. Ships as a complete feature.

**Phase 2 — the cosmetic tail.** Progress `🔗` markers and the CSV extras note.

Phasing isolates the `ExerciseCard` refactor from the cosmetic work.

## Testing

Node logic tests (`groupedExercises`, rounds reconciliation):

- single exercise, a pair, a triset
- members separated by a non-member (grouping by first appearance)
- a group reduced to one member collapses to a single
- `rounds` reconciles divergent `targetSets` via `max`
- `unlink` leaves two independent exercises

Server-render tests: round blocks render at the right count, per-member deltas
and set counts appear, the `— now` marker lands on the first incomplete round,
extras render as a solo tail row.

Real-Chrome tests, driven against a seeded blob:

- **Single-exercise logging regression** covering the `exerciseEntry`
  refactor: open a normal card, log sets, confirm cascade, target placeholder,
  green/red and completion all behave as before.
- Link a pair in Manage; confirm the group appears in Log with the right round
  count.
- Log a full round; assert both entries are written under their own exercise
  ids, and that no volume is merged.
- Unlink; confirm two independent cards return with their sets intact.

Both files must compile clean via the `esbuild` extraction from `CLAUDE.md`, and
the new code must be identical across `index.html` and `j.html` — supersets are
not in the intentional-differences table.

## Golden rules touched

- **Rule 5** (per exercise per machine): preserved by keeping session entries
  keyed by exercise id. Explicitly asserted in tests.
- **Rule 3** (seed changes don't reach existing users): no seed change and no
  migration needed, since absent `supersetId` is the correct default.
- **Rule 4** (semantic colours): the chain accent must not use `pos`/`neg`/
  `amber` semantically; round and member status keep the existing colour meanings.
- **Rule 2** (never sync the differences table): the feature is identical in both
  files; nothing in the table changes.
