# Deload Weeks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user flag weeks of a cycle as deload (recovery) weeks, give those weeks their own exercise list, and keep them out of every volume comparison and aggregation.

**Architecture:** Two new blob fields — `deloadWeeks` (0-based week indices) and `deloadPlan` (exercise list keyed by day). Deload exercises live in a separate object, so no existing code can see them unless changed to look. A handful of predicates (`isDeloadWeek`, `isDeloadSess`, `exListFor`) are added once and then threaded through the comparison and aggregation call sites.

**Tech Stack:** React 18 UMD + Babel-standalone, compiled in the browser. No build step, no bundler, no module system. All app code is JSX inside one `<script type="text/babel">` tag per HTML file.

**Spec:** `docs/superpowers/specs/2026-08-03-deload-week-design.md`

## Global Constraints

- **Every change goes into BOTH `index.html` and `j.html`.** They are ~95% identical by design. A task is not done until both files have it.
- **Never touch a `STORAGE_KEY`.** `franco-fit-a-v2` (index) and `franco-fit-j-v1` (j) stay exactly as they are.
- **Never read, edit, copy, or move the `CELEBRATIONS` arrays, `RAW`, `freshSeed`, or `seedJ` between files.** They differ on purpose. This feature adds no new celebration copy of any kind.
- **Semantic colors are sacred:** green = beat previous, red = down, amber = tie/no comparison, blue = today/timer accent. The deload glyph uses `T.muted`, never `T.pos`/`T.neg`/`T.amber`.
- **Preserve accessibility:** every new icon button needs an `aria-label`; the week chips also need `aria-pressed`. No new animation that ignores `prefers-reduced-motion`.
- **New UI copy, verbatim:** section heading `Deload weeks`; helper text `Lighter recovery weeks. Kept out of volume totals, records, streaks and rep targets.`; Today-view header segment ` · ☾ deload`; schedule tabs `Normal` and `☾ Deload`.
- **The deload glyph is `☾` (U+263E)** everywhere — chips, day pills, heatmap, Today header, chart markers.
- **Line numbers in this plan refer to `index.html`.** `j.html` has the identical construct roughly 93–107 lines earlier. Always locate the edit in `j.html` by searching for the quoted code snippet, never by line number.

### Verification contract

This project has no test framework and no runner. App code lives inside an HTML `<script>` tag with no exports, so there is nothing to import into a unit test. Standing up a harness is out of scope. Instead, **every task ends with the compile gate below plus the task's own manual browser check.**

Compile gate (from CLAUDE.md) — both commands must exit 0 with no output:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');fs.writeFileSync('/tmp/a.jsx',h.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/)[1])" && npx --yes esbuild /tmp/a.jsx --loader:.jsx=jsx --outfile=/dev/null
node -e "const fs=require('fs');const h=fs.readFileSync('j.html','utf8');fs.writeFileSync('/tmp/j.jsx',h.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/)[1])" && npx --yes esbuild /tmp/j.jsx --loader:.jsx=jsx --outfile=/dev/null
```

Manual checks run against `python3 -m http.server` at `http://localhost:8000/index.html` and `http://localhost:8000/j.html`.

**Do not push to `main` during this plan.** Pushing is deploying. Commit locally; the user pushes when the whole feature is verified.

---

### Task 1: Data model foundation

Adds the two fields and the three predicates. No visible behavior change — this task exists so every later task has its vocabulary.

**Files:**
- Modify: `index.html` — `buildSeed` (278), after `weekOfCycle` (400–401), load migration (2952–2962), new-cycle handler (2251–2253)
- Modify: `j.html` — same four sites (`buildSeed` 245, `weekOfCycle` 367, migration 2852–2862, new-cycle 2158–2160)

**Interfaces:**
- Produces: `isDeloadWeek(data, w) -> boolean`, `isDeloadSess(data, sess) -> boolean`, `exListFor(data, day, w) -> Array<exercise>`, `seedDeloadPlan(d) -> void` (mutates draft in place). Blob fields `data.deloadWeeks: number[]`, `data.deloadPlan: { [day: string]: exercise[] }`.

- [ ] **Step 1: Add the seed fields**

In `index.html` `buildSeed`, the object already contains `sentNotes: []` and `noteAcks: {}` at lines 288–289. Add directly beneath them:

```js
    deloadWeeks: [],
    deloadPlan: {},
```

Do the same in `j.html` at its `sentNotes: []` / `noteAcks: {}` pair (lines 255–256). `buildSeed` is the shared builder that both `freshSeed` and `seedJ` call, so this one edit per file covers both seed paths. **Do not open `freshSeed` or `seedJ` themselves.**

- [ ] **Step 2: Add the predicates**

In `index.html`, immediately after the `weekOfCycle` definition that ends on line 401 (`Math.floor((new Date(iso + "T12:00:00") - new Date(data.cycleStart + "T12:00:00")) / (7 * 864e5));`) and before `function cellDateFor`, insert:

```js
/* ---- Deload weeks -------------------------------------------------
   A deload is a planned lighter recovery week. Its sessions are logged
   normally but must never enter a volume comparison: no rep targets, no
   green/red, no star, no record, and no contribution to cycle totals. */
const isDeloadWeek = (data, w) => (data.deloadWeeks || []).includes(w);
const isDeloadSess = (data, s) => isDeloadWeek(data, weekOfCycle(data, s.date));

/* The exercise list for a day in a given week — the deload plan replaces
   the normal program entirely during a deload week. */
const exListFor = (data, day, w) =>
  isDeloadWeek(data, w)
    ? ((data.deloadPlan || {})[day] || [])
    : data.exercises.filter((e) => e.day === day);

/* Copy the current program into the deload plan at half the planned sets.
   Runs once per day; a day already in the plan is never overwritten.
   Copied exercises keep their original id so lastEntryFor can still find
   the matching heavy-week history for the reference line. */
function seedDeloadPlan(d) {
  d.deloadPlan = d.deloadPlan || {};
  for (const day of DAYS) {
    if (d.deloadPlan[day]) continue;
    d.deloadPlan[day] = d.exercises
      .filter((e) => e.day === day)
      .map((e) => ({
        ...e,
        targetSets: Math.max(1, Math.ceil((e.targetSets || 3) / 2)),
        variants: e.variants.map((v) => ({ ...v })),
      }));
  }
}
```

Insert the identical block in `j.html` after its `weekOfCycle` (line 367–368).

- [ ] **Step 3: Add the load migration**

In `index.html`, the migration block runs lines 2952–2962 and currently ends with `if (!parsed.noteAcks) parsed.noteAcks = {};`. Add beneath it:

```js
          if (!parsed.deloadWeeks) parsed.deloadWeeks = [];
          if (!parsed.deloadPlan) parsed.deloadPlan = {};
```

Same in `j.html` after its `if (!parsed.noteAcks) parsed.noteAcks = {};` (line 2862). This is what reaches existing users — seed changes do not (Golden Rule 3).

- [ ] **Step 4: Carry the flags across a new cycle**

In `index.html` the new-cycle handler runs:

```js
      d.cycleNumber += 1;
      d.cycleName = `Cycle ${d.cycleNumber}`;
      d.cycleStart = todayISO();
```

Add immediately after `d.cycleStart = todayISO();`:

```js
      /* Deload plan carries over; flagged weeks are clipped to the new length */
      d.deloadWeeks = (d.deloadWeeks || []).filter((w) => w < (d.cycleWeeks || 8));
```

Same in `j.html` (lines 2158–2160).

- [ ] **Step 5: Run the compile gate**

Run both commands from the Verification contract above.
Expected: both exit 0, no output. A `Transform failed` message means a JSX syntax error — fix before continuing.

- [ ] **Step 6: Verify the migration on real data**

Serve with `python3 -m http.server`, open `http://localhost:8000/index.html`, and in the browser console run:

```js
JSON.parse(localStorage.getItem("franco-fit-a-v2"))
```

Expected: the object has `deloadWeeks: []` and `deloadPlan: {}`, and every pre-existing field (`sessions`, `exercises`, `cycleStart`, `sentNotes`, `noteAcks`) is untouched. Repeat on `j.html` with key `franco-fit-j-v1`.

- [ ] **Step 7: Commit**

```bash
git add index.html j.html
git commit -m "Add deload week data model and predicates"
```

---

### Task 2: Flag deload weeks in Manage → Cycle

Makes the feature reachable. After this task the user can mark weeks; nothing else reacts yet.

**Files:**
- Modify: `index.html` — Cycle card in `ManageView`, after the `cycleWeeks` stepper row ending at 2450
- Modify: `j.html` — same card (search `Started {fmtDate(data.cycleStart)} · week {weekNum}`)

**Interfaces:**
- Consumes: `seedDeloadPlan(d)` and `data.deloadWeeks` from Task 1.
- Produces: a populated `data.deloadWeeks` / `data.deloadPlan` for Tasks 3–7 to read.

- [ ] **Step 1: Add the week chip row**

In `index.html`, find the row ending with:

```jsx
          <span style={{ color: T.faint, fontSize: 12.5, marginLeft: "auto" }}>Started {fmtDate(data.cycleStart)} · week {weekNum}</span>
```

That `<Row>` closes just below it. Insert this immediately after that closing `</Row>`:

```jsx
        <div style={{ marginTop: 12 }}>
          <div style={{ color: T.muted, fontSize: 13, marginBottom: 6 }}>Deload weeks</div>
          <Row style={{ gap: 6, flexWrap: "wrap" }}>
            {Array.from({ length: data.cycleWeeks || 8 }, (_, i) => {
              const on = isDeloadWeek(data, i);
              return (
                <button key={i} className="ll-btn ll-btn-sm"
                  aria-pressed={on}
                  aria-label={`Week ${i + 1}${on ? ", deload week" : ""}`}
                  style={{
                    minWidth: 40,
                    borderColor: on ? T.blue : T.line,
                    color: on ? T.blue : T.muted,
                    background: on ? "rgba(91,157,255,0.12)" : "transparent",
                  }}
                  onClick={() => update((d) => {
                    const list = (d.deloadWeeks || []).slice();
                    const at = list.indexOf(i);
                    if (at >= 0) {
                      list.splice(at, 1);
                    } else {
                      list.push(i);
                      list.sort((a, b) => a - b);
                      seedDeloadPlan(d);
                    }
                    d.deloadWeeks = list;
                  })}>
                  {on ? "☾ " : ""}{i + 1}
                </button>
              );
            })}
          </Row>
          <div style={{ color: T.faint, fontSize: 12, marginTop: 6 }}>
            Lighter recovery weeks. Kept out of volume totals, records, streaks and rep targets.
          </div>
        </div>
```

Insert the identical block at the matching place in `j.html`.

Note `seedDeloadPlan` runs on flag-on only, and is a no-op for days already present — so un-flagging and re-flagging never destroys an edited plan.

- [ ] **Step 2: Run the compile gate**

Both commands from the Verification contract. Expected: exit 0, no output.

- [ ] **Step 3: Verify in the browser**

On `index.html` → Manage → Cycle:
1. A `Deload weeks` row shows one chip per week (8 by default).
2. Tap week 4. It turns blue with a `☾`. Console: `JSON.parse(localStorage.getItem("franco-fit-a-v2")).deloadWeeks` → `[3]`.
3. Console: `JSON.parse(localStorage.getItem("franco-fit-a-v2")).deloadPlan` → an object with a key per training day, each an array whose `targetSets` are the halved values (a 6-set exercise → 3, a 3-set → 2, a 2-set → 1).
4. Tap week 4 again. Chip goes grey, `deloadWeeks` → `[]`, **and `deloadPlan` is still fully populated.**
5. Change cycle length to 3 weeks, then `Start new cycle`; confirm `deloadWeeks` contains no index ≥ 3.

Repeat on `j.html`.

- [ ] **Step 4: Commit**

```bash
git add index.html j.html
git commit -m "Add deload week chips to Manage cycle card"
```

---

### Task 3: Deload tab in Manage → Schedule

Parameterizes the existing per-day exercise editor so the same controls edit either list.

**Files:**
- Modify: `index.html` — `ManageView` (2131) for new state; schedule day cards (2468–2543)
- Modify: `j.html` — `ManageView` (2038); schedule day cards (search `{data.exercises.filter((e) => e.day === day).map((ex, i, arr) => (`)

**Interfaces:**
- Consumes: `isDeloadWeek`, `data.deloadPlan` from Task 1.
- Produces: an editable `data.deloadPlan[day]`. No new exported names.

- [ ] **Step 1: Add editor state and list accessors**

In `index.html` `ManageView`, alongside the existing `const [editing, setEditing] = useState(null);` and `newNames` state, add:

```js
  const [schedTab, setSchedTab] = useState("normal");
  const deloadOn = (data.deloadWeeks || []).length > 0;
  const editingDeload = deloadOn && schedTab === "deload";

  /* Read side: which array the day card renders */
  const listFor = (day) =>
    editingDeload
      ? ((data.deloadPlan || {})[day] || [])
      : data.exercises.filter((e) => e.day === day);

  /* Write side: the array to mutate inside update(). In normal mode this is
     the whole flat exercises array; in deload mode it is that day's plan.
     Reorder and rename both locate by id, so the same code works for both. */
  const mutListFor = (d, day) => {
    if (!editingDeload) return d.exercises;
    d.deloadPlan = d.deloadPlan || {};
    d.deloadPlan[day] = d.deloadPlan[day] || [];
    return d.deloadPlan[day];
  };
  const findEx = (d, day, id) => mutListFor(d, day).find((x) => x.id === id);
  const removeEx = (d, day, id) => {
    if (editingDeload) d.deloadPlan[day] = (d.deloadPlan[day] || []).filter((x) => x.id !== id);
    else d.exercises = d.exercises.filter((x) => x.id !== id);
  };
```

Add the identical block to `j.html`'s `ManageView`.

- [ ] **Step 2: Add the tab switch above the day cards**

In `index.html`, the schedule section begins with `{DAYS.map((day) => (` at line 2468, preceded by the comment `{/* Schedule */}`. Insert between the comment and the `{DAYS.map(` line:

```jsx
      {deloadOn && (
        <Row style={{ gap: 6, marginBottom: 2 }}>
          {[["normal", "Normal"], ["deload", "☾ Deload"]].map(([k, lbl]) => (
            <button key={k} className="ll-btn ll-btn-sm"
              aria-pressed={schedTab === k}
              style={{
                borderColor: schedTab === k ? T.blue : T.line,
                color: schedTab === k ? T.blue : T.muted,
                background: schedTab === k ? "rgba(91,157,255,0.12)" : "transparent",
              }}
              onClick={() => setSchedTab(k)}>{lbl}</button>
          ))}
        </Row>
      )}
```

Same in `j.html`.

- [ ] **Step 3: Rebind the day card to the accessors**

In `index.html`, inside the `{DAYS.map((day) => (` block, make exactly these six substitutions. Every other line stays as-is.

1. Line 2474 — the list source:
```jsx
          {data.exercises.filter((e) => e.day === day).map((ex, i, arr) => (
```
becomes:
```jsx
          {listFor(day).map((ex, i, arr) => (
```

2. Line 2480 — icon edit:
```jsx
                      value={ex.icon || ""} onChange={(e) => update((d) => { d.exercises.find((x) => x.id === ex.id).icon = e.target.value; })} />
```
becomes:
```jsx
                      value={ex.icon || ""} onChange={(e) => update((d) => { findEx(d, day, ex.id).icon = e.target.value; })} />
```

3. Line 2484 — rename:
```jsx
                      if (t) update((d) => { d.exercises.find((x) => x.id === ex.id).name = t; });
```
becomes:
```jsx
                      if (t) update((d) => { findEx(d, day, ex.id).name = t; });
```

4. Lines 2490–2494 — the two planned-sets steppers:
```jsx
                      update((d) => { const x = d.exercises.find((x) => x.id === ex.id); x.targetSets = Math.max(1, (x.targetSets || 3) - 1); })}>−</button>
```
becomes:
```jsx
                      update((d) => { const x = findEx(d, day, ex.id); x.targetSets = Math.max(1, (x.targetSets || 3) - 1); })}>−</button>
```
and:
```jsx
                      update((d) => { const x = d.exercises.find((x) => x.id === ex.id); x.targetSets = (x.targetSets || 3) + 1; })}>+</button>
```
becomes:
```jsx
                      update((d) => { const x = findEx(d, day, ex.id); x.targetSets = (x.targetSets || 3) + 1; })}>+</button>
```

5. Lines 2505 and 2512 — both reorder handlers. In each, replace `const list = d.exercises;` with:
```jsx
                        const list = mutListFor(d, day);
```
The two `findIndex((x) => x.id === ...)` lines and the swap below them are unchanged.

6. Line 2519 — delete:
```jsx
                      onClick={() => update((d) => { d.exercises = d.exercises.filter((x) => x.id !== ex.id); })}>✕</button>
```
becomes:
```jsx
                      onClick={() => update((d) => { removeEx(d, day, ex.id); })}>✕</button>
```

7. Lines 2531–2538 — the add handler:
```jsx
              update((d) => {
                d.exercises.push({
```
becomes:
```jsx
              update((d) => {
                mutListFor(d, day).push({
```
The pushed object literal (`id`, `day`, `name`, `prev: null`, `targetSets: 3`, `variants`, `activeVariant`) is unchanged.

Apply the same seven substitutions in `j.html`.

- [ ] **Step 4: Run the compile gate**

Both commands. Expected: exit 0, no output.

- [ ] **Step 5: Verify in the browser**

On `index.html` → Manage:
1. With no deload weeks flagged, the Schedule section shows **no** tab switch and behaves exactly as before.
2. Flag week 4 in the Cycle card. The `Normal` / `☾ Deload` switch appears.
3. `Normal` tab: your real program, with the original set counts.
4. `☾ Deload` tab: the same exercises at halved set counts.
5. On the Deload tab, rename one exercise, drop another with `✕`, and add `Bike 10 min`.
6. Switch to `Normal`: **the rename, the deletion and the addition are all absent — the real program is untouched.** This is the core guarantee of the feature; if it fails, stop and fix before continuing.
7. Console: `JSON.parse(localStorage.getItem("franco-fit-a-v2")).exercises.length` is unchanged from before step 5.

Repeat on `j.html`.

- [ ] **Step 6: Commit**

```bash
git add index.html j.html
git commit -m "Add deload tab to Manage schedule editor"
```

---

### Task 4: Today view trains the deload plan

The week now actually looks and behaves like a deload while you log it.

**Files:**
- Modify: `index.html` — `lastEntryFor` (418–430), `TodayView` (1168, 1177, header 1369, card render 1412), `ExerciseCard` (662, SetRow render 929–930)
- Modify: `j.html` — `lastEntryFor` (385), `TodayView` (1075, 1084), `ExerciseCard` (629)

**Interfaces:**
- Consumes: `isDeloadWeek`, `isDeloadSess`, `exListFor` from Task 1; `data.deloadPlan` from Task 3.
- Produces: `ExerciseCard` gains a required `isDeload` prop (boolean).

- [ ] **Step 1: Teach `lastEntryFor` to skip deload sessions**

In `index.html`, the loop body currently reads:

```js
    if (s.key === excludeKey) continue;
    if (beforeDate && s.date >= beforeDate) continue;
    const e = s.entries[exId];
```

Insert one line so it becomes:

```js
    if (s.key === excludeKey) continue;
    if (beforeDate && s.date >= beforeDate) continue;
    if (isDeloadSess(data, s)) continue;
    const e = s.entries[exId];
```

Same edit in `j.html`.

This single line does four jobs: it stops a deload session from becoming the "beat last week" baseline for the following normal week, it removes green/red from deload sets (there is no comparison session to find), it gives the deload card a *heavy-week* reference line, and it keeps the cycle-rollover `prev` field pointing at real working weights.

- [ ] **Step 2: Switch `TodayView` to the deload plan**

In `index.html` `TodayView`, replace line 1177:

```js
  const exList = data.exercises.filter((e) => e.day === day);
```

with:

```js
  const isDeload = isDeloadWeek(data, wIdx);
  const exList = exListFor(data, day, wIdx);
```

`wIdx` is already defined three lines above. Same edit in `j.html` (line 1084).

- [ ] **Step 3: Mark the week in the header**

In `index.html` line 1369, the sub-header reads:

```jsx
            Cycle {data.cycleNumber} · Week {wIdx + 1}{OPTIONAL_DAYS[day] ? " · optional day" : ""}{isToday ? " · today" : weekOffset < 0 ? " · past week" : weekOffset > 0 ? " · upcoming" : ""}
```

Insert the deload segment right after the week number:

```jsx
            Cycle {data.cycleNumber} · Week {wIdx + 1}{isDeload ? " · ☾ deload" : ""}{OPTIONAL_DAYS[day] ? " · optional day" : ""}{isToday ? " · today" : weekOffset < 0 ? " · past week" : weekOffset > 0 ? " · upcoming" : ""}
```

`j.html` has no `OPTIONAL_DAYS` entries by default but the same expression is present — make the identical insertion there.

- [ ] **Step 4: Pass the flag into the card**

In `index.html` line 1412:

```jsx
        <ExerciseCard key={ex.id} data={data} update={update} ex={ex} sessionKey={sessionKey} dayColor={DAY_COLOR[day]} />
```

becomes:

```jsx
        <ExerciseCard key={ex.id} data={data} update={update} ex={ex} sessionKey={sessionKey} dayColor={DAY_COLOR[day]} isDeload={isDeload} />
```

Same in `j.html`.

- [ ] **Step 5: Suppress comparison inside the card**

In `index.html`, change the `ExerciseCard` signature on line 662:

```js
function ExerciseCard({ data, update, ex, sessionKey, dayColor }) {
```

to:

```js
function ExerciseCard({ data, update, ex, sessionKey, dayColor, isDeload }) {
```

Then at the `SetRow` render (lines 929–930), this:

```jsx
                  <SetRow key={i} idx={i} set={s} unit={data.unit} repGoal={ex.repGoal}
                    compareSet={!s.extra ? lastLogged[i] : undefined}
```

becomes:

```jsx
                  <SetRow key={i} idx={i} set={s} unit={data.unit} repGoal={ex.repGoal}
                    compareSet={isDeload || s.extra ? undefined : lastLogged[i]}
```

With `compareSet` undefined, `SetRow` already skips the whole target/coloring branch (line 600, `if (compareSet)`) and falls back to the `repGoal` placeholder. No change to `SetRow` itself is needed.

Same two edits in `j.html`.

- [ ] **Step 6: Stop variant edits from leaking into the real program**

`ExerciseCard`'s variant controls mutate `d.exercises` directly at three sites. Deload plan entries are *copies that keep the original id*, so during a deload week `d.exercises.find((x) => x.id === ex.id)` would find and mutate the **normal program's** exercise — a silent leak — or return `undefined` and throw for a deload-only movement. Both are unacceptable.

In `index.html`, just below the `ExerciseCard` signature you changed in Step 5, add:

```js
  /* The array this card's exercise actually lives in. Deload plan entries
     keep the program's ids, so writing to d.exercises during a deload week
     would mutate the real program instead of the plan. */
  const exHome = (d) => (isDeload ? ((d.deloadPlan || {})[ex.day] || []) : d.exercises);
```

Then replace **all three** occurrences of:

```js
                        const dex = d.exercises.find((x) => x.id === ex.id);
```

(at lines 855, 868 and 890 — check the indentation at each site and keep it as found) with:

```js
                        const dex = exHome(d).find((x) => x.id === ex.id);
```

Verify you got all three: `grep -c "d\.exercises\.find" index.html` should drop by exactly 3.

Apply the same change at the matching three sites in `j.html`.

- [ ] **Step 7: Run the compile gate**

Both commands. Expected: exit 0, no output.

- [ ] **Step 8: Verify in the browser**

Set up: on `index.html`, flag week 4 as deload, and make sure you have at least one logged session in an earlier week for the day you test.

1. Navigate the Today view with `›` to week 4. Header reads `Cycle N · Week 4 · ☾ deload`.
2. The exercise list is the **deload** plan (your renamed/added entries from Task 3), not the normal program.
3. Open an exercise card. The set rows show the plain rep-goal placeholder — **no `12+` style beat-last-week target**.
4. Type a weight and reps well below your usual. The reps field stays uncolored — **no green, no red**.
5. The card's "last time" reference line shows a **heavy** week's numbers, not another deload's.
6. Navigate back to week 3 (non-deload). Targets and green/red are working normally there.
7. Log week 4 fully, then go to week 5: its rep targets are computed from **week 3**, not from the light week 4 numbers.
8. In week 4, open a card and add a machine variant, then switch to it. Now go to Manage → Schedule → `Normal` and open that exercise: **the new variant must not be there.** Then check Manage → Schedule → `☾ Deload`: it is. If the variant leaked into the normal program, Step 6 was applied incompletely.

Repeat on `j.html`.

- [ ] **Step 9: Commit**

```bash
git add index.html j.html
git commit -m "Train the deload plan in the Today view"
```

---

### Task 5: The ☾ status on day pills and the heatmap

**Files:**
- Modify: `index.html` — `dayWeekStatus` (561–578), `DayStatusIcon` (580–589), `CycleGrid` cells (1808–1832)
- Modify: `j.html` — `dayWeekStatus` (528), `DayStatusIcon` (547), `CycleGrid` (1665)

**Interfaces:**
- Consumes: `isDeloadWeek` from Task 1.
- Produces: `dayWeekStatus` can now return the new string `"deload"`; `DayStatusIcon` renders it.

- [ ] **Step 1: Return the new status**

In `index.html` `dayWeekStatus`, the body currently reads:

```js
  const sess = daySessionIn(data, d, w);
  if (sess) {
    const finished = sess.celebrated || sess.date < today;
    if (!finished) return "logged";
    let prev = null;
    for (let i = w - 1; i >= 0; i--) { const p = daySessionIn(data, d, i); if (p) { prev = p; break; } }
```

Replace that with:

```js
  const sess = daySessionIn(data, d, w);
  if (sess) {
    if (isDeloadWeek(data, w)) return "deload";
    const finished = sess.celebrated || sess.date < today;
    if (!finished) return "logged";
    let prev = null;
    for (let i = w - 1; i >= 0; i--) {
      if (isDeloadWeek(data, i)) continue;
      const p = daySessionIn(data, d, i); if (p) { prev = p; break; }
    }
```

The rest of the function is unchanged. Note the unlogged branches below (`today` / `missed` / `optional` / `future`) deliberately still apply during a deload week — an un-trained deload day is still a missed day.

Same edit in `j.html`.

- [ ] **Step 2: Render the glyph**

In `index.html` `DayStatusIcon`, after the `missed` line and before `const st = {`:

```js
  if (status === "missed") return <span style={{ color: T.faint, fontSize: size + 2, lineHeight: 1, flex: "none" }}>✕</span>;
```

insert:

```js
  if (status === "deload") return <span style={{ color: T.muted, fontSize: size + 3, lineHeight: 1, flex: "none", opacity: 0.85 }}>☾</span>;
```

`T.muted` is used deliberately — the deload glyph must not borrow a semantic color (Global Constraints). Same edit in `j.html`.

- [ ] **Step 3: Mirror it in the heatmap**

In `index.html` `CycleGrid`, the cell logic inside `if (sess) {` runs:

```jsx
                if (sess) {
                  let prev = null;
                  for (let i = w - 1; i >= 0; i--) { const p = daySessionIn(data, d, i); if (p) { prev = p; break; } }
                  const dv = dayVolume(sess);
```

Replace those first three lines with:

```jsx
                if (sess) {
                  let prev = null;
                  for (let i = w - 1; i >= 0; i--) {
                    if (isDeloadWeek(data, i)) continue;
                    const p = daySessionIn(data, d, i); if (p) { prev = p; break; }
                  }
                  const dv = dayVolume(sess);
```

Then, immediately after `const finishedCell = sess.celebrated || sess.date < today;`, insert a deload branch ahead of the existing `if (!finishedCell)`:

```jsx
                  if (isDeloadWeek(data, w)) {
                    content = <span style={{ color: T.muted, fontSize: 12, opacity: 0.85 }}>☾</span>;
                  } else if (!finishedCell) {
```

— that is, change the existing `if (!finishedCell) {` into the `} else if (!finishedCell) {` shown above. The star, red-dot and green-dot branches below it are untouched, and a deload cell can now never reach them.

Same edits in `j.html`.

- [ ] **Step 4: Run the compile gate**

Both commands. Expected: exit 0, no output.

- [ ] **Step 5: Verify in the browser**

With week 4 flagged and a session logged in it on `index.html`:
1. The day pill for that day in week 4 shows a muted `☾` — not a star, not a red dot, not green.
2. Progress → the cycle heatmap: the whole week-4 column shows `☾` for logged days.
3. Log a *deliberately light* week-4 session on a day where week 3 was heavy. It still shows `☾`, **never a red dot**.
4. Week 5 logged heavier than week 3 still earns its star — confirming the walk-back skipped week 4 rather than comparing against it.
5. An untrained past day in week 4 still shows `✕` (or a dashed ring if it is an optional day).

Repeat on `j.html`.

- [ ] **Step 6: Commit**

```bash
git add index.html j.html
git commit -m "Show deload days as a moon on pills and heatmap"
```

---

### Task 6: Keep deload out of stats, records and the finale

**Files:**
- Modify: `index.html` — `fireCelebration` record + finale (1277–1300), `StatStrip` wins (1587–1595), `TrendCard` (1626–1663)
- Modify: `j.html` — same three (`StatStrip` 1488, `TrendCard` 1524)

**Interfaces:**
- Consumes: `isDeloadWeek`, `isDeloadSess` from Task 1.
- Produces: chart points gain an optional `deload: true` field consumed by the chart renderer in the same component.

- [ ] **Step 1: Suppress the weekly record**

In `index.html` `fireCelebration`, the record block reads:

```js
    const wNow = weekOfCycle(data, sess.date);
```

and a few lines below:

```js
      for (let k = wNow - 1; k >= 0; k--) { const p = daySessionIn(data, day, k); if (p) { prevDay = p; break; } }
      record = !!(prevDay && dayVolume(sess) > dayVolume(prevDay));
```

Replace those two lines with:

```js
      for (let k = wNow - 1; k >= 0; k--) {
        if (isDeloadWeek(data, k)) continue;
        const p = daySessionIn(data, day, k); if (p) { prevDay = p; break; }
      }
      record = !isDeloadWeek(data, wNow) && !!(prevDay && dayVolume(sess) > dayVolume(prevDay));
```

**Do not touch anything else in `fireCelebration`.** The message selection — the pending-note lookup, `deliverNote`, and the fallback to this file's `CELEBRATIONS` array — is intentionally identical on a deload day. Only the confetti/record flag changes.

Same edit in `j.html`.

- [ ] **Step 2: Exclude deload from the finale recap**

Still in `fireCelebration`, the finale block reads:

```js
      const inCycle = sortedSessions(data).filter((x) => weekOfCycle(data, x.date) >= 0);
```

becomes:

```js
      const inCycle = sortedSessions(data).filter((x) => weekOfCycle(data, x.date) >= 0 && !isDeloadSess(data, x));
```

And in the wins loop just below, this:

```js
          const sx = daySessionIn(data, dd, wi);
```

is preceded by adding a skip at the top of the `wi` loop body:

```js
          if (isDeloadWeek(data, wi)) continue;
          const sx = daySessionIn(data, dd, wi);
```

and the inner walk-back:

```js
          for (let k = wi - 1; k >= 0; k--) { const p = daySessionIn(data, dd, k); if (p) { pv = p; break; } }
```

becomes:

```js
          for (let k = wi - 1; k >= 0; k--) {
            if (isDeloadWeek(data, k)) continue;
            const p = daySessionIn(data, dd, k); if (p) { pv = p; break; }
          }
```

Same edits in `j.html`.

- [ ] **Step 3: Exclude deload from the Wins tile**

In `index.html` `StatStrip`, this:

```js
    const list = sortedSessions(data).filter(
      (s) => s.day === d && weekOfCycle(data, s.date) >= 0 && Object.values(s.entries).some(entryHasData)
    );
```

becomes:

```js
    const list = sortedSessions(data).filter(
      (s) => s.day === d && weekOfCycle(data, s.date) >= 0 && !isDeloadSess(data, s) && Object.values(s.entries).some(entryHasData)
    );
```

Leave `currentStreak` alone — a deload day is a day you trained, so it keeps the streak alive by design.

Same edit in `j.html`.

- [ ] **Step 4: Mute the deload bar in the volume chart**

In `index.html` `TrendCard`, the weekly volume branch reads:

```js
      ? weeks.map((w) => {
          const list = byWeek[w];
          return { label: `Week ${w + 1}`, short: `W${w + 1}`, value: list.reduce((a, s) => a + dayVolume(s), 0), sub: `${list.length} sessions` };
        })
      : scoped.map((s) => ({ label: `${s.day} · ${fmtDate(s.date)}`, short: domShort(s.date), value: dayVolume(s) }));
```

becomes:

```js
      ? weeks.map((w) => {
          const list = byWeek[w];
          const dl = isDeloadWeek(data, w);
          return {
            label: `Week ${w + 1}${dl ? " · deload" : ""}`,
            short: dl ? `☾${w + 1}` : `W${w + 1}`,
            value: list.reduce((a, s) => a + dayVolume(s), 0),
            sub: `${list.length} sessions`,
            deload: dl,
          };
        })
      : scoped.map((s) => ({
          label: `${s.day} · ${fmtDate(s.date)}${isDeloadSess(data, s) ? " · deload" : ""}`,
          short: domShort(s.date),
          value: dayVolume(s),
          deload: isDeloadSess(data, s),
        }));
```

Deload weeks stay in `weeks`/`scoped` on purpose — the bar renders so you can see the work, it just reads as recovery rather than as a collapse.

Same edits in `j.html`.

- [ ] **Step 5: Mute the deload point in `LineChart`**

The volume chart is a **line chart with per-point dots** (`LineChart`, index.html:1499 / j.html:1406), not a bar chart. `LineChart` takes a single `color` for the whole series, so the deload point is muted at the dot.

In `index.html`, the dot renderer reads:

```jsx
        {points.map((p, i) => (
          <g key={`p${i}`}>
            <circle cx={x(i)} cy={y(p.value)} r="12" fill="transparent" style={{ cursor: "pointer" }} onClick={() => { setSel(i); if (onSelect) onSelect(p, i); }} />
            {i === sel
              ? <circle cx={x(i)} cy={y(p.value)} r="4.5" fill={color} />
              : <circle cx={x(i)} cy={y(p.value)} r="2.8" fill={T.bg} stroke={color} strokeWidth="1.5" />}
          </g>
        ))}
```

Replace it with:

```jsx
        {points.map((p, i) => {
          const c = p.deload ? T.muted : color;
          return (
            <g key={`p${i}`}>
              <circle cx={x(i)} cy={y(p.value)} r="12" fill="transparent" style={{ cursor: "pointer" }} onClick={() => { setSel(i); if (onSelect) onSelect(p, i); }} />
              {i === sel
                ? <circle cx={x(i)} cy={y(p.value)} r="4.5" fill={c} />
                : <circle cx={x(i)} cy={y(p.value)} r="2.8" fill={T.bg} stroke={c} strokeWidth="1.5" />}
            </g>
          );
        })}
```

The line, area gradient and axis stay the series color — only the deload dot goes muted. The `☾4` axis label from Step 4 carries the rest of the signal. `LineChart` is shared with the bodyweight and duration charts; those pass points with no `deload` field, so `p.deload` is `undefined` and they are unaffected.

Same edit in `j.html`.

- [ ] **Step 6: Run the compile gate**

Both commands. Expected: exit 0, no output.

- [ ] **Step 7: Verify in the browser**

On `index.html`, with week 4 flagged and logged light, and weeks 3 and 5 logged normally:
1. Progress → volume chart, scope `all`: the week-4 dot is muted grey with a `☾4` axis label; weeks 3 and 5 keep the normal accent color.
2. Tap the week-4 dot: its label reads `Week 4 · deload`.
3. The `Wins` tile does not increase when week 4 beats week 3, and does not decrease because week 4 lost to week 3.
4. The `Streak` tile **does** count the deload days.
5. Finish a deload session that would otherwise beat the prior week: **no gold confetti, no `NEW WEEKLY RECORD`.** The celebration itself still appears with a normal message — or with your partner's note if one is pending.
6. Confirm the celebration message came from the usual source (that file's own `CELEBRATIONS`, or a connected note) and that nothing deload-specific was written.
7. Switch the chart metric to `Bodyweight` and to `Time`: both render exactly as before, unaffected by the `LineChart` change.

Repeat on `j.html`.

- [ ] **Step 8: Commit**

```bash
git add index.html j.html
git commit -m "Exclude deload weeks from stats, records and finale"
```

---

### Task 7: CSV export

**Files:**
- Modify: `index.html` — `buildSheetRows` (447–520)
- Modify: `j.html` — `buildSheetRows` (414)

**Interfaces:**
- Consumes: `isDeloadWeek`, `data.deloadPlan` from Task 1.
- Produces: nothing consumed downstream. Final task.

- [ ] **Step 1: Label deload weeks in the header row**

In `index.html` `buildSheetRows`, the header loop reads:

```js
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < SETS; i++) {
      h1.push(i === 0 ? `Week ${w + 1}` : "");
      h2.push(String(i + 1));
    }
  }
```

becomes:

```js
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < SETS; i++) {
      h1.push(i === 0 ? `Week ${w + 1}${isDeloadWeek(data, w) ? " (deload)" : ""}` : "");
      h2.push(String(i + 1));
    }
  }
```

Same in `j.html`.

- [ ] **Step 2: Include deload-only exercises in the day rows**

The per-day loop currently reads:

```js
  for (const day of DAYS) {
    rows.push([day]);
    for (const ex of data.exercises.filter((e) => e.day === day)) {
```

becomes:

```js
  for (const day of DAYS) {
    rows.push([day]);
    /* union of the normal program and any deload-only movements, so a
       deload week's work is not silently dropped from the export */
    const dayEx = data.exercises.filter((e) => e.day === day);
    const seenIds = new Set(dayEx.map((e) => e.id));
    for (const de of ((data.deloadPlan || {})[day] || [])) {
      if (!seenIds.has(de.id)) { seenIds.add(de.id); dayEx.push(de); }
    }
    for (const ex of dayEx) {
```

The loop body below is unchanged — it already looks each exercise up per week and leaves blank cells where there is no data, so a deload-only movement simply shows blanks in the working weeks.

Same in `j.html`.

- [ ] **Step 3: Run the compile gate**

Both commands. Expected: exit 0, no output.

- [ ] **Step 4: Verify the export**

On `index.html` → Manage → Data → export the CSV, open it:
1. The week-4 header cell reads `Week 4 (deload)`.
2. The deload-only exercise you added in Task 3 (`Bike 10 min`) appears as a row under its day, with data only in the deload week's columns.
3. Your normal exercises are all still present with their full history.

Repeat on `j.html`.

- [ ] **Step 5: Commit**

```bash
git add index.html j.html
git commit -m "Label deload weeks in the CSV export"
```

---

## Deliberately unchanged

An implementer may be tempted to "fix" these. Do not.

- **`daySessionIn` (index.html:411)** — must keep finding deload sessions, because `TodayView` uses it to locate the session you are logging. All exclusion happens in its callers.
- **`currentStreak` (index.html:1486)** — a deload day is a day you trained. It keeps the streak.
- **`ProgressView`'s `exList` (index.html:2004 / j.html:1911)** — the per-day exercise history browser stays bound to `data.exercises`. It shows long-run progression across weeks, which is a property of the real program; deload-only movements have no meaningful progression history.
- **`fireCelebration`'s message selection** — pending connected notes and each file's own `CELEBRATIONS` array behave identically on a deload day. There is no `DELOAD_LINES` array anywhere in this feature.
- **Both `CELEBRATIONS` arrays, `RAW`, `freshSeed`, `seedJ`** — never opened by this feature.

## Known accepted behavior

- Deleting an exercise from the deload plan hides its card but does not delete logged set data; re-adding the exercise brings the data back.
- A deload day whose plan is empty shows no exercises and therefore no Start/Finish button — it reads as a rest day. The connected-notes composer may still offer that date as a workout chip; a note sent to it rolls forward to the next finished session, which is existing undelivered-note behavior.
- If the final week of a cycle is a deload, the finale still fires on its last scheduled day, but its volume total and win count exclude the deload week.

## Final verification before handing back

Run the full compile gate once more, then walk the spec's eight-step manual pass (spec § Verification) against **both** files. Report which steps passed. Do not push to `main` — that is the user's call, and it is a live deploy to two phones.
