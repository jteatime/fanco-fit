# Unit-Aware Volume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make volume, comparisons and charts correct across a kg→lb change, and let the Log tab navigate back into earlier cycles.

**Architecture:** Each set gets a `u` unit stamp — written by a one-time migration derived from cycle date ranges, and at log time thereafter. `volumeOf` becomes the single conversion point to canonical kg, so every consumer of `scoreOf` becomes correct without a signature change. Display converts canonical kg into the user's current unit; the editable input alone shows the native stored value. Phase 2 re-points `TodayView`'s week indexing at a date-resolved cycle, reusing the `cycleViews`/`viewFor` machinery the supersets work added.

**Tech Stack:** React 18 UMD + Babel-standalone, JSX inline in a single `<script type="text/babel">` per HTML file. No bundler. Tests are plain Node scripts: esbuild (via npx) to extract the in-page script, react-dom/server for render assertions, puppeteer-core driving the installed Chrome for UI assertions.

**Spec:** `docs/superpowers/specs/2026-09-23-unit-aware-volume-design.md`

## Global Constraints

- **Every change lands in BOTH `index.html` and `j.html`, byte-identical for the new code.** Units are NOT in the intentional-differences table.
- **Never rewrite a logged `w` value.** The whole approach exists to avoid that. A migration that changes stored weights is a failed task.
- **Never change a `STORAGE_KEY`**: `franco-fit-a-v2` in index.html, `franco-fit-j-v1` in j.html.
- **Never edit, copy or sync** `CELEBRATIONS`, `RAW`, the seed functions, `REFEED_ROTATION`, `DAYS`/`OPTIONAL_DAYS` initial values, or the connected-notes constants. **The per-build seed unit is READ by the migration (`kg` for `j.html`, `lb` for `index.html` — `freshSeed` sets `d.unit = "lb"`) and must not be homogenised.**
- **Canonical unit is kg.** `const KG_PER_LB = 0.45359237;`
- **Semantic colours are sacred:** `T.pos` = beat previous, `T.neg` = down, `T.amber` = tie/no comparison, `T.blue` = today/timer accent. This work changes verdict *values*, never their meaning.
- **Comparisons stay per exercise per machine** via `lastEntryFor`. This work makes them unit-correct; it must not widen or narrow what they compare.
- **The migration must be idempotent.** It runs on every load.
- Both files must compile clean:
  ```bash
  node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');fs.writeFileSync('/tmp/a.jsx',h.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/)[1])" && npx --yes esbuild /tmp/a.jsx --loader:.jsx=jsx --outfile=/dev/null
  ```
  (and the same for `j.html`)
- **Never commit `test/node_modules`.** Stage files deliberately.
- Chrome suites need `python3 -m http.server 8777` from the repo root. Kill it when done.
- Test fixtures must use `test/fixture.js` (`fixtureDay()`, `weeksBefore()`, `ago()`). Hardcoding a weekday makes a suite pass one day in seven.
- Commit after every task. **Do not push.**

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `index.html` | Version A app, full source | Modify — all feature code |
| `j.html` | Version J app, full source | Modify — identical feature code |
| `test/superset-logic.test.js` | Pure-logic assertions (already holds grouping + CSV + fixture coverage) | Extend — unit math, migration |
| `test/superset-render.test.js` | react-dom/server assertions | Extend — display conversion |
| `test/superset-ui.test.js` | Real-Chrome flows | Extend — continuity, unit switch, Log navigation |
| `test/logging-regression.test.js` | Guards single-exercise logging | Re-run only; must stay at 16 |

No new files. The app stays two self-contained HTML files.

---

## Task 1: Canonical unit math

**Files:**
- Modify: `index.html` (the `volumeOf` / `scoreOf` helper block), `j.html` (same)
- Test: `test/superset-logic.test.js`

**Interfaces:**
- Consumes: `num` (existing).
- Produces:
  - `KG_PER_LB` = `0.45359237`
  - `kgOf(set) -> number` — the set's weight in kg
  - `toUnit(kg, unit) -> number` — canonical kg expressed in `unit`
  - `volumeOf(sets) -> number` — canonical kg volume (same signature as today)

- [ ] **Step 1: Write the failing test**

Append inside the `for (const file of ["index.html", "j.html"])` loop in `test/superset-logic.test.js`, after the `partnersOf` block. Add `"kgOf"`, `"toUnit"`, `"volumeOf"`, `"scoreOf"` to the `API` array at the top of the file.

```javascript
  /* ---- canonical unit math ---- */
  {
    const s = (w, r, u) => ({ w, r, extra: false, tag: "", ...(u ? { u } : {}) });
    eq("a kg set is already canonical", M.kgOf(s(100, 10, "kg")), 100);
    eq("an lb set converts to kg", Math.round(M.kgOf(s(100, 10, "lb")) * 1000) / 1000, 45.359);
    eq("an unstamped set is treated as kg", M.kgOf(s(100, 10)), 100);
    eq("a blank weight is zero", M.kgOf(s("", 10, "lb")), 0);

    eq("toUnit back to kg is identity", M.toUnit(100, "kg"), 100);
    eq("toUnit to lb inverts kgOf", Math.round(M.toUnit(45.359237, "lb")), 100);

    /* the actual defect: 70kg and 180lb must not be added as one quantity */
    const mixed = [s(70, 10, "kg"), s(180, 10, "lb")];
    const expected = 70 * 10 + 180 * 0.45359237 * 10;
    ok("volumeOf converts before summing",
       Math.abs(M.volumeOf(mixed) - expected) < 0.001,
       `-> ${M.volumeOf(mixed).toFixed(2)} vs ${expected.toFixed(2)}`);
    ok("the naive sum is NOT what we get", Math.abs(M.volumeOf(mixed) - 2500) > 1,
       `-> naive would be 2500, got ${M.volumeOf(mixed).toFixed(2)}`);

    eq("a skipped set contributes nothing",
       M.volumeOf([{ w: 100, r: 10, skipped: true, u: "kg" }]), 0);

    /* scoreOf's bodyweight fallback is a rep count and stays unitless */
    eq("bodyweight sets still score as reps",
       M.scoreOf([s("", 12, "lb"), s("", 10, "lb")]), 22);
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/superset-logic.test.js`
Expected: FAIL — `ReferenceError: kgOf is not defined` from the harness's generated `module.exports` line.

- [ ] **Step 3: Write the implementation**

In **both** files, replace this line:

```javascript
const volumeOf = (sets) => sets.reduce((a, s) => a + (s.skipped ? 0 : num(s.w) * num(s.r)), 0);
```

with:

```javascript
/* ---- Units -------------------------------------------------------
   A set stores the number the user typed, in whatever unit was current
   at the time, plus a `u` stamp saying which. All volume math is done in
   canonical kg so a kg-era session and an lb-era session can be compared
   without lying about either; display converts back out.
   An unstamped set is read as kg — after the migration only weightless
   rows are unstamped, so this cannot misread real data, and it keeps
   volumeOf total for a hand-edited blob. */
const KG_PER_LB = 0.45359237;
const kgOf = (s) => (s.u === "lb" ? num(s.w) * KG_PER_LB : num(s.w));
const toUnit = (kg, unit) => (unit === "lb" ? kg / KG_PER_LB : kg);
const volumeOf = (sets) => sets.reduce((a, s) => a + (s.skipped ? 0 : kgOf(s) * num(s.r)), 0);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/superset-logic.test.js`
Expected: PASS, `0 failed`. Record the total in your report.

- [ ] **Step 5: Verify both files compile**

Run the two esbuild commands from Global Constraints. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add test/superset-logic.test.js index.html j.html
git commit -m "Make volume math canonical in kg

volumeOf was the sum of w x r with no notion of unit, so a 70kg set and a
180lb set were added as one quantity. kgOf converts per set from its own u
stamp and volumeOf sums canonically, which fixes every consumer of scoreOf
without changing a signature. An unstamped set reads as kg."
```

---

## Task 2: The migration

**Files:**
- Modify: `index.html` (insert `migrateUnits` after `migrateCycleHistory`; call it in the load `useEffect` beside the existing `migrateCycleHistory(parsed)` call), `j.html` (same)
- Test: `test/superset-logic.test.js`

**Interfaces:**
- Consumes: `cycleViews`, `viewFor`, `entryHasData` (existing); `SEED_UNIT` (new, per-build).
- Produces: `migrateUnits(d) -> d` — stamps `cycleHistory[i].unit`, every weighted set's `u`, and `ex.prevU`. Idempotent.

**Critical:** `SEED_UNIT` differs per build and that difference is deliberate. In `index.html` it is `"lb"`; in `j.html` it is `"kg"`. It is the ONLY line of this task that differs between the files. Do not homogenise it, and do not read it from `data.unit` — the whole point is that `data.unit` is now `lb` on both installs while Franco's history is kg.

- [ ] **Step 1: Write the failing test**

Append inside the per-file loop in `test/superset-logic.test.js`, after the unit-math block. Add `"migrateUnits"` and `"SEED_UNIT"` to the `API` array.

```javascript
  /* ---- the migration ---- */
  {
    const st = (w, r) => ({ w, r, extra: false, tag: "" });
    const mkSess = (date, day, w) => ({
      date, day, celebrated: true,
      entries: { a: { variantId: "main", note: "", swapName: "", sets: [st(w, 10), st(w, 8)] } },
    });
    const FD2 = FXX.fixtureDay();
    const OLD = FXX.weeksBefore(6, FD2.date);   /* inside the archived cycle */
    const NEW = FD2.date;                        /* inside the live cycle */
    const mk = () => ({
      version: 1, unit: "lb", userName: "T", nameAsked: true, theme: "iron",
      rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
      deloadWeeks: [], deloadPlan: {},
      cycleHistory: [{ number: 1, name: "Cycle 1", start: FXX.ago(120, FD2.date),
                       end: FXX.ago(7, FD2.date), weeks: 16, deloadWeeks: [] }],
      cycleNumber: 2, cycleName: "Cycle 2", cycleWeeks: 8, cycleStart: FXX.ago(6, FD2.date),
      exercises: [{ id: "a", day: FD2.day, name: "Leg Press", prev: 70, targetSets: 2,
                    variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" }],
      sessions: { [`${OLD}|${FD2.day}`]: mkSess(OLD, FD2.day, 70),
                  [`${NEW}|${FD2.day}`]: mkSess(NEW, FD2.day, 180) },
    });

    const d = M.migrateUnits(mk());
    eq("the archived cycle takes this build's seed unit",
       d.cycleHistory[0].unit, M.SEED_UNIT);
    eq("archived-cycle sets are stamped with it",
       d.sessions[`${OLD}|${FD2.day}`].entries.a.sets.map((s) => s.u),
       [M.SEED_UNIT, M.SEED_UNIT]);
    eq("live-cycle sets take the current unit",
       d.sessions[`${NEW}|${FD2.day}`].entries.a.sets.map((s) => s.u), ["lb", "lb"]);
    eq("ex.prevU is stamped from the outgoing cycle",
       d.exercises[0].prevU, M.SEED_UNIT);

    /* no logged weight may change — that is the whole premise */
    eq("stored weights are untouched",
       [d.sessions[`${OLD}|${FD2.day}`].entries.a.sets[0].w,
        d.sessions[`${NEW}|${FD2.day}`].entries.a.sets[0].w], [70, 180]);

    /* idempotent: a second run changes nothing */
    const once = JSON.stringify(d);
    eq("migration is idempotent", JSON.stringify(M.migrateUnits(d)), once);

    /* an existing stamp is authoritative and never overwritten */
    const pre = mk();
    pre.sessions[`${OLD}|${FD2.day}`].entries.a.sets[0].u = "lb";
    eq("a pre-existing stamp survives",
       M.migrateUnits(pre).sessions[`${OLD}|${FD2.day}`].entries.a.sets[0].u, "lb");

    /* a weightless row stays unstamped until a weight is typed */
    const blank = mk();
    blank.sessions[`${NEW}|${FD2.day}`].entries.a.sets = [{ w: "", r: "", extra: false, tag: "" }];
    eq("a weightless set is left unstamped",
       "u" in M.migrateUnits(blank).sessions[`${NEW}|${FD2.day}`].entries.a.sets[0], false);

    /* a blob with no archived cycles: everything is the live unit */
    const single = mk();
    single.cycleHistory = [];
    single.cycleStart = FXX.ago(120, FD2.date);
    const sd = M.migrateUnits(single);
    eq("no archived cycles -> all sets take the live unit",
       [sd.sessions[`${OLD}|${FD2.day}`].entries.a.sets[0].u,
        sd.sessions[`${NEW}|${FD2.day}`].entries.a.sets[0].u], ["lb", "lb"]);
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/superset-logic.test.js`
Expected: FAIL — `ReferenceError: migrateUnits is not defined`.

- [ ] **Step 3: Write the implementation**

In **both** files, insert after the closing brace of `migrateCycleHistory`:

```javascript

/* The unit this build seeds with, and therefore the unit its pre-migration
   history was logged in. NOT data.unit: an install that has since switched
   country reports the NEW unit there while its history is in the old one.
   This value differs per build on purpose — see CLAUDE.md. */
const SEED_UNIT = "kg";

/* Stamp every weighted set with the unit it was logged in, once.

   The unit change coincided with a cycle boundary, so a set's cycle
   identifies its unit: an archived cycle was logged in SEED_UNIT, the live
   cycle in data.unit. Stamping at migration rather than plumbing date
   context through the volume functions means scoreOf and everything built
   on it keep their signatures.

   Idempotent — it runs on every load. A set that already carries `u` is
   authoritative and is never rewritten, and no stored weight is modified. */
function migrateUnits(d) {
  const views = cycleViews(d);
  for (const c of (d.cycleHistory || [])) {
    if (!c.unit) c.unit = SEED_UNIT;
  }
  const unitAt = (iso) => {
    const v = viewFor(cycleViews(d), iso);
    if (!v) return d.unit || SEED_UNIT;
    if (v.isCurrent) return d.unit || SEED_UNIT;
    const rec = (d.cycleHistory || []).find((c) => c.number === v.number);
    return (rec && rec.unit) || SEED_UNIT;
  };
  for (const s of Object.values(d.sessions || {})) {
    const u = unitAt(s.date);
    for (const e of Object.values(s.entries || {})) {
      for (const st of (e.sets || [])) {
        if (st.u) continue;                /* already stamped */
        if (!(num(st.w) > 0)) continue;    /* weightless row: stamp on entry */
        st.u = u;
      }
    }
  }
  /* ex.prev is written at rollover from the outgoing cycle's top weight, so
     its unit is that cycle's unit — the most recent archived one. */
  const lastArchived = (d.cycleHistory || [])[(d.cycleHistory || []).length - 1];
  const prevU = (lastArchived && lastArchived.unit) || SEED_UNIT;
  for (const ex of (d.exercises || [])) {
    if (ex.prev != null && !ex.prevU) ex.prevU = prevU;
  }
  return d;
}
```

Then, in `index.html` ONLY, change that one constant:

```javascript
const SEED_UNIT = "lb";
```

Leave `j.html` at `"kg"`. Add a line to the differences table in `CLAUDE.md`:

```markdown
| `SEED_UNIT` | `"lb"` | `"kg"` | the unit this build's pre-migration history was logged in |
```

- [ ] **Step 4: Call it in the load path**

In **both** files, in the load `useEffect`, immediately after the existing line:

```javascript
          migrateCycleHistory(parsed);
```

add:

```javascript
          migrateUnits(parsed);
```

Order matters: `migrateUnits` resolves cycles via `cycleViews`, which needs `cycleHistory` to exist.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node test/superset-logic.test.js`
Expected: PASS, `0 failed`.

- [ ] **Step 6: Verify the migration against the real blob shape**

```bash
node -e '
const fs=require("fs"), cp=require("child_process"), path=require("path");
const load=require("./test/harness.js");
const M=load(path.join(process.cwd(),"j.html"),["migrateUnits","volumeOf","scoreOf","cycleViews","SEED_UNIT"],require("os").tmpdir());
/* a blob shaped like the real one: an archived kg cycle plus a live lb cycle */
const d={version:1,unit:"lb",bwUnit:"lb",weights:{},sentNotes:[],noteAcks:{},
 deloadWeeks:[],deloadPlan:{},userName:"JT",nameAsked:true,theme:"iron",rewardId:"gold-star",
 cycleHistory:[{number:2,name:"Cycle 2",start:"2026-06-15",end:"2026-09-21",weeks:15,deloadWeeks:[7]}],
 cycleNumber:3,cycleName:"Cycle 3",cycleStart:"2026-09-22",cycleWeeks:14,
 exercises:[{id:"lp",day:"Tuesday",name:"Leg Press",prev:70,targetSets:6,variants:[{id:"main",name:"Usual machine"}],activeVariant:"main"}],
 sessions:{
  "2026-09-15|Tuesday":{date:"2026-09-15",day:"Tuesday",celebrated:true,entries:{lp:{variantId:"main",note:"",swapName:"",sets:[{w:70,r:15},{w:70,r:15}]}}},
  "2026-09-22|Tuesday":{date:"2026-09-22",day:"Tuesday",celebrated:true,entries:{lp:{variantId:"main",note:"",swapName:"",sets:[{w:180,r:9},{w:180,r:9}]}}}}};
M.migrateUnits(d);
const old=d.sessions["2026-09-15|Tuesday"].entries.lp.sets.map(s=>s.u).join(",");
const nu=d.sessions["2026-09-22|Tuesday"].entries.lp.sets.map(s=>s.u).join(",");
console.log("SEED_UNIT (j.html):", M.SEED_UNIT);
console.log("cycle-2 sets stamped:", old, old==="kg,kg"?"OK":"WRONG");
console.log("cycle-3 sets stamped:", nu, nu==="lb,lb"?"OK":"WRONG");
const volOld=M.volumeOf(d.sessions["2026-09-15|Tuesday"].entries.lp.sets);
const volNew=M.volumeOf(d.sessions["2026-09-22|Tuesday"].entries.lp.sets);
console.log("cycle-2 volume (kg):", volOld.toFixed(1), "expect 2100.0");
console.log("cycle-3 volume (kg):", volNew.toFixed(1), "expect", (180*0.45359237*18).toFixed(1));
console.log("naive sum would have been:", (70*30 + 180*18), "-- the bug");
'
```

Expected: `cycle-2 sets stamped: kg,kg OK`, `cycle-3 sets stamped: lb,lb OK`, cycle-2 volume `2100.0`, cycle-3 volume `1469.6`. Paste this output into your report — it is the evidence that the real data will migrate correctly.

- [ ] **Step 7: Verify both files compile**

Run the two esbuild commands. Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add test/superset-logic.test.js index.html j.html CLAUDE.md
git commit -m "Stamp each set with the unit it was logged in

The unit change coincided with a cycle boundary, so a set's cycle
identifies its unit: archived cycles were logged in this build's
SEED_UNIT, the live cycle in data.unit. Stamping once at migration
rather than plumbing date context through the volume functions keeps
scoreOf and its consumers at their current signatures.

Idempotent, and no stored weight is modified — an existing stamp is
authoritative and weightless rows stay unstamped until a weight is typed.
SEED_UNIT differs per build on purpose and is now in the differences
table: data.unit reports the NEW unit on an install that has switched
country, while its history is in the old one."
```

---

## Task 3: Stamp new sets at log time

**Files:**
- Modify: `index.html` (`exerciseEntry`'s `ensureEntry` and `changeSet`), `j.html` (same)
- Test: `test/superset-ui.test.js`

**Interfaces:**
- Consumes: `migrateUnits` (Task 2), `cycleViews`/`viewFor` (existing).
- Produces: `exerciseEntry` gains a `sessionUnit` value in its returned object — the unit a new set in this session should take.

**Why not just `data.unit`:** once Task 6 lets the Log tab reach a cycle-2 week, a correction typed there must be stamped `kg`, not the current `lb`. The unit belongs to the session's cycle.

- [ ] **Step 1: Write the failing test**

In `test/superset-ui.test.js`, after the existing `ok("curl round 1 landed on curl", ...)` assertion, add:

```javascript
  /* Every weight typed carries the unit it was typed in, so volume stays
     canonical without re-deriving dates later. */
  const stamps = await page.evaluate((k, date) => {
    const d = JSON.parse(localStorage.getItem(k));
    const key = Object.keys(d.sessions).find((x) => x.startsWith(date));
    const e = d.sessions[key].entries;
    return { press: e.press.sets[0].u, curl: e.curl.sets[0].u, unit: d.unit };
  }, KEY, FD.date);
  ok("a newly logged set is stamped with the session's unit",
     stamps.press === stamps.unit && stamps.curl === stamps.unit,
     `-> press=${stamps.press} curl=${stamps.curl} data.unit=${stamps.unit}`);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python3 -m http.server 8777 >/dev/null 2>&1 &
node test/superset-ui.test.js j.html
```
Expected: FAIL — `press=undefined curl=undefined data.unit=kg`, because nothing stamps at log time yet.

- [ ] **Step 3: Write the implementation**

In **both** files, inside `exerciseEntry`, add this just above `const ensureEntry = (d) => {`:

```javascript
  /* The unit a new set in THIS session should carry. Not data.unit: once the
     Log tab can reach an earlier cycle, a correction typed into a kg week
     must be stamped kg, not today's lb. */
  const sessionUnit = (() => {
    const v = viewFor(cycleViews(data), sessionKey.split("|")[0]);
    if (!v || v.isCurrent) return data.unit || "kg";
    const rec = (data.cycleHistory || []).find((c) => c.number === v.number);
    return (rec && rec.unit) || data.unit || "kg";
  })();
```

Then in `changeSet`, stamp on write. Replace:

```javascript
  const changeSet = (i, ns) =>
    update((d) => {
      const e = ensureEntry(d);
      const oldW = String(e.sets[i].w ?? "");
      e.sets[i] = ns;
```

with:

```javascript
  const changeSet = (i, ns) =>
    update((d) => {
      const e = ensureEntry(d);
      const oldW = String(e.sets[i].w ?? "");
      /* Stamp the unit the moment a weight exists. Clearing a weight drops
         the stamp too, so a re-entry in a different unit is not mislabelled. */
      e.sets[i] = num(ns.w) > 0
        ? { ...ns, u: ns.u || sessionUnit }
        : (() => { const { u, ...rest } = ns; return rest; })();
```

Add `sessionUnit` to the returned object of `exerciseEntry`, alongside `lastLogged`:

```javascript
    todayVol, lastVol, liveDelta, beating, stripColor, bodyweight, lastLogged, sessionUnit,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node test/superset-ui.test.js j.html
node test/superset-ui.test.js index.html
```
Expected: PASS on both.

- [ ] **Step 5: Re-run the other suites**

```bash
node test/superset-logic.test.js
node test/superset-render.test.js
node test/logging-regression.test.js j.html
node test/logging-regression.test.js index.html
```
Expected: all pass; `logging-regression` stays at 16 each.

- [ ] **Step 6: Verify both files compile**

Run the two esbuild commands. Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add test/superset-ui.test.js index.html j.html
git commit -m "Stamp the unit on every weight as it is typed

changeSet now writes u alongside w, taking the unit from the session's
cycle rather than data.unit — so a correction typed into an earlier kg
week is stamped kg, not today's lb. Clearing a weight drops the stamp,
so re-entering in a different unit is not mislabelled.

This closes the hole a migration alone leaves: switching unit mid-cycle."
```

---

## Task 4: Display in the current unit

**Files:**
- Modify: `index.html` (`fmtVol` and its 6 call sites, `setsLine` and its 8 call sites, `SetRow`'s target and the weight-column header), `j.html` (same)
- Test: `test/superset-render.test.js`

**Interfaces:**
- Consumes: `kgOf`, `toUnit`, `KG_PER_LB` (Task 1); `sessionUnit` (Task 3).
- Produces:
  - `fmtVol(kg, unit) -> string` — canonical kg rendered in `unit`, with the unit appended
  - `setsLine(sets, unit) -> string` — each set converted into `unit`

**This is the task most likely to be done half-way.** `fmtVol` has 6 call sites and `setsLine` has 8; a missed one silently prints kg where lb is meant, which is the same bug class this work exists to remove. The step below lists every line number.

- [ ] **Step 1: Write the failing test**

Append to `test/superset-render.test.js`, before the final `console.log`:

```javascript
/* ---- display converts canonical kg into the current unit ---- */
for (const file of ["index.html", "j.html"]) {
  const M = loadWithRealReact(file, ["fmtVol", "setsLine", "volumeOf", "toUnit", "applyTheme", "applySchedule"]);
  M.applySchedule(undefined);
  M.applyTheme("iron");
  console.log(`\n== ${file} · unit display ==`);

  const kgSets = [{ w: 70, r: 10, u: "kg" }, { w: 70, r: 10, u: "kg" }];
  const vol = M.volumeOf(kgSets);                 /* 1400 kg canonical */
  ok("volume in kg reads as kg", /1,400/.test(M.fmtVol(vol, "kg")) && /kg/.test(M.fmtVol(vol, "kg")),
     `-> ${M.fmtVol(vol, "kg")}`);
  ok("the same volume in lb is larger and labelled lb",
     /3,0[0-9][0-9]/.test(M.fmtVol(vol, "lb")) && /lb/.test(M.fmtVol(vol, "lb")),
     `-> ${M.fmtVol(vol, "lb")}`);

  /* a kg-era set displayed while the user is in lb */
  ok("setsLine converts a kg set into lb", /154/.test(M.setsLine(kgSets, "lb")),
     `-> ${M.setsLine(kgSets, "lb")}`);
  ok("setsLine leaves a kg set alone in kg", /70×10/.test(M.setsLine(kgSets, "kg")),
     `-> ${M.setsLine(kgSets, "kg")}`);
  const lbSets = [{ w: 180, r: 9, u: "lb" }];
  ok("setsLine leaves an lb set alone in lb", /180×9/.test(M.setsLine(lbSets, "lb")),
     `-> ${M.setsLine(lbSets, "lb")}`);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/superset-render.test.js`
Expected: FAIL — `fmtVol` ignores its second argument and prints no unit; `setsLine` ignores it entirely.

- [ ] **Step 3: Rewrite the two formatters**

In **both** files, replace:

```javascript
const fmtVol = (n) => Math.round(n).toLocaleString("en-US");
```

with:

```javascript
/* Volume arrives canonical (kg) and is shown in the unit the user is in, so
   an all-time chart is continuous across a country move. */
const fmtVol = (kg, unit) =>
  `${Math.round(toUnit(kg, unit || "kg")).toLocaleString("en-US")} ${unit || "kg"}`;
```

and replace:

```javascript
const setsLine = (sets) =>
  sets
    .filter((s) => !s.skipped && (num(s.r) > 0 || num(s.w) > 0))
    .map((s) => `${s.w}×${s.r}${s.tag ? ` (${s.tag})` : ""}`)
    .join("  ");
```

with:

```javascript
/* Read-only set lines convert into the current unit so a kg-era session and
   an lb-era one can be read side by side. The EDITABLE input deliberately
   does not — see SetRow. */
const setsLine = (sets, unit) =>
  sets
    .filter((s) => !s.skipped && (num(s.r) > 0 || num(s.w) > 0))
    .map((s) => {
      const w = num(s.w) > 0 ? Math.round(toUnit(kgOf(s), unit || "kg") * 10) / 10 : s.w;
      return `${w}×${s.r}${s.tag ? ` (${s.tag})` : ""}`;
    })
    .join("  ");
```

- [ ] **Step 4: Update every `fmtVol` call site**

Six sites. Each gains `data.unit` (or the nearest available unit in scope). Find them with `grep -n "fmtVol(" index.html`:

1. `ExerciseCard`'s last-time panel: `vol ${fmtVol(lastVol)}` → `${fmtVol(lastVol, data.unit)}` (drop the now-redundant `vol ` prefix, since the unit label reads better).
2. `ExerciseCard`'s "Today:" line: `{fmtVol(todayVol)}` → `{fmtVol(todayVol, data.unit)}`, and drop the trailing `{isBodyweight(todaySets) ? "reps" : "vol"}` for the non-bodyweight branch — keep `reps` for bodyweight.
3. The finale: `{fmtVol(finale.vol)}` → `{fmtVol(finale.vol, data.unit)}`.
4. The Progress day drill-in: `{fmtVol(vol)}` → `{fmtVol(vol, data.unit)}`.
5. The drill-in per-exercise line: `fmtVol(evol)` → `fmtVol(evol, data.unit)`.
6. The exercise-history rows: `fmtVol(r.vol)` → `fmtVol(r.vol, data.unit)`.

- [ ] **Step 5: Update every `setsLine` call site**

Eight sites, all read-only. Each gains `data.unit`. Find them with `grep -n "setsLine(" index.html`:

`ExerciseCard`'s header last-time (`last ${fmtDate(...)}: ${setsLine(...)}`), `ExerciseCard`'s last-time panel, `ExerciseCard`'s other-machine line, `SupersetCard`'s collapsed member summary, `SupersetCard`'s detail last-time, `SupersetCard`'s detail other-machine, the Progress drill-in per-exercise sets, and the exercise-history rows.

- [ ] **Step 6: Make `SetRow`'s target unit-correct, and label the column**

In **both** files, in `SetRow`, replace the target block:

```javascript
  const w = num(set.w), r = num(set.r);
  let repsCls = "";
  let target = null;
  if (compareSet) {
    const lw = num(compareSet.w), lr = num(compareSet.r);
    const lastScore = lw > 0 ? lw * lr : lr;
    /* reps needed at today's weight to beat last week's set */
    if (w > 0) target = Math.floor((lw * lr) / w) + 1;
    else if (lw === 0) target = lr + 1;
    if (r > 0) {
      const todayScore = lw === 0 && w === 0 ? r : w * r;
      repsCls = todayScore > lastScore ? "good" : todayScore < lastScore ? "bad" : "";
    }
  }
```

with:

```javascript
  const w = num(set.w), r = num(set.r);
  let repsCls = "";
  let target = null;
  if (compareSet) {
    /* Compare canonically: last week may be in a different unit from today,
       and the answer must come back in THIS row's unit or the target would be
       scaled wrong. */
    const lwKg = kgOf(compareSet), lr = num(compareSet.r);
    const wKg = kgOf(set);
    const lastScore = lwKg > 0 ? lwKg * lr : lr;
    if (wKg > 0) target = Math.floor((lwKg * lr) / wKg) + 1;
    else if (lwKg === 0) target = lr + 1;
    if (r > 0) {
      const todayScore = lwKg === 0 && wKg === 0 ? r : wKg * r;
      repsCls = todayScore > lastScore ? "good" : todayScore < lastScore ? "bad" : "";
    }
  }
```

`target` is a rep count, so it needs no unit conversion — dividing canonical by canonical cancels the unit. The weight input keeps `value={set.w}`: the native stored value, per the spec's deliberate exception.

Then label the column when the row's unit differs from the current one. In `ExerciseCard`'s weight×reps header, replace:

```javascript
                  <span>weight ({data.unit || "kg"})</span><span>×</span><span style={{ color: T.amber }}>reps</span>
```

with:

```javascript
                  <span>weight ({(todaySets.find((s) => s.u) || {}).u || sessionUnit || data.unit || "kg"})</span><span>×</span><span style={{ color: T.amber }}>reps</span>
```

Make the identical change in `SupersetCard`'s header, which has the same markup.

- [ ] **Step 7: Run the test to verify it passes**

Run: `node test/superset-render.test.js`
Expected: PASS, `0 failed`.

- [ ] **Step 8: Re-run every suite**

```bash
node test/superset-logic.test.js
node test/logging-regression.test.js j.html
node test/logging-regression.test.js index.html
node test/superset-ui.test.js j.html
node test/superset-ui.test.js index.html
```
Expected: all pass. If a `logging-regression` assertion fails on a volume or sets string, it is because that text now carries a unit — update the TEST's expectation, not the app, and say which in your report.

- [ ] **Step 9: Confirm no call site was missed**

```bash
grep -n "fmtVol(" index.html j.html | grep -v "unit" || echo "every fmtVol call passes a unit"
grep -n "setsLine(" index.html j.html | grep -v "unit" || echo "every setsLine call passes a unit"
```
Expected: both lines print the "every ..." message. A hit here is a missed site.

- [ ] **Step 10: Verify both files compile, then commit**

```bash
git add test/superset-render.test.js index.html j.html
git commit -m "Show volume and historical sets in the current unit

fmtVol goes from a bare number formatter to fmtVol(kg, unit): it converts
canonical kg into the unit in use and labels it, across all six call
sites. setsLine converts each set the same way across its eight sites, so
a kg-era session and an lb-era one read side by side.

SetRow's target now compares canonically — last week may be in a
different unit from today — and the result is a rep count, so the units
cancel. The weight INPUT still shows the native stored value: a converted
number in an editable field invites a stray keystroke writing 154 lb over
a real 70 kg entry. The column header names the row's own unit instead."
```

---

## Task 5: CSV `Units` block, and end-to-end continuity

**Files:**
- Modify: `index.html` (`buildSheetRows`), `j.html` (same)
- Test: `test/superset-logic.test.js`, `test/superset-ui.test.js`

**Interfaces:**
- Consumes: `cycleViews` (existing), `SEED_UNIT` (Task 2).
- Produces: no new exported names.

- [ ] **Step 1: Write the failing tests**

In `test/superset-logic.test.js`, inside the per-file loop after the CSV `Supersets` block assertions:

```javascript
  /* ---- CSV: the Units block ---- */
  {
    const FD3 = FXX.fixtureDay();
    const st = (w, r, u) => ({ w, r, extra: false, tag: "", ...(u ? { u } : {}) });
    const mixed = {
      version: 1, unit: "lb", userName: "T", nameAsked: true, theme: "iron",
      rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
      deloadWeeks: [], deloadPlan: {},
      cycleHistory: [{ number: 1, name: "Cycle 1", start: FXX.ago(120, FD3.date),
                       end: FXX.ago(7, FD3.date), weeks: 16, deloadWeeks: [], unit: "kg" }],
      cycleNumber: 2, cycleName: "Cycle 2", cycleWeeks: 8, cycleStart: FXX.ago(6, FD3.date),
      exercises: [{ id: "a", day: FD3.day, name: "Leg Press", prev: 70, targetSets: 2,
                    variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" }],
      sessions: { [`${FD3.date}|${FD3.day}`]: { date: FD3.date, day: FD3.day, celebrated: true,
        entries: { a: { variantId: "main", note: "", swapName: "", sets: [st(180, 9, "lb")] } } } },
    };
    const flat = M.buildSheetRows(mixed).map((r) => (r || []).join("|"));
    eq("a mixed-unit export gains a Units block", flat.includes("Units"), true);
    eq("its header names the columns", flat.includes("Cycle|Unit"), true);
    ok("it records the archived cycle's unit", flat.some((r) => /^Cycle 1\|kg$/.test(r)),
       `-> ${flat.filter((r) => /\|(kg|lb)$/.test(r)).join(" ;; ")}`);
    ok("and the live cycle's unit", flat.some((r) => /^Cycle 2\|lb$/.test(r)));

    /* one unit everywhere -> no block, so a single-unit export is unchanged */
    const same = JSON.parse(JSON.stringify(mixed));
    same.cycleHistory[0].unit = "lb";
    eq("a single-unit export has no Units block",
       M.buildSheetRows(same).map((r) => (r || []).join("|")).includes("Units"), false);
  }
```

In `test/superset-ui.test.js`, after the Progress-marker assertions:

```javascript
  /* The whole point: an all-time volume figure must not jump when the unit
     changes. Switching unit re-scales what is DISPLAYED and must leave every
     stored weight and stamp untouched. */
  const before = await page.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    const key = Object.keys(d.sessions)[0];
    const e = Object.values(d.sessions[key].entries)[0];
    return { unit: d.unit, w: String(e.sets[0].w), u: e.sets[0].u };
  }, KEY);
  ok("Manage opens for the unit switch", await clickText("Manage")); await wait(700);
  /* Manage has TWO kg/lb rows — "Lifting" (data.unit) and "Bodyweight"
     (data.bwUnit) — and neither carries aria-pressed; the active one is
     marked by an "on" class. Scope to the Lifting row or this flips the
     wrong field. */
  const flipped = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("div")]
      .filter((d) => /^Lifting\s*(kg|lb)\s*(kg|lb)\s*$/.test((d.textContent || "").replace(/\s+/g, " ").trim()));
    const row = rows[rows.length - 1];
    if (!row) return false;
    const btn = [...row.querySelectorAll("button")]
      .find((b) => /^(kg|lb)$/.test((b.textContent || "").trim()) &&
                   !String(b.className).split(/\s+/).includes("on"));
    if (!btn) return false;
    btn.click();
    return true;
  });
  ok("found the inactive Lifting unit button", flipped); await wait(900);
  const after = await page.evaluate((k) => {
    const d = JSON.parse(localStorage.getItem(k));
    const key = Object.keys(d.sessions)[0];
    const e = Object.values(d.sessions[key].entries)[0];
    return { unit: d.unit, w: String(e.sets[0].w), u: e.sets[0].u };
  }, KEY);
  ok("the display unit changed", after.unit !== before.unit, `-> ${before.unit} -> ${after.unit}`);
  ok("the stored weight did NOT change", after.w === before.w, `-> ${before.w} -> ${after.w}`);
  ok("the stored stamp did NOT change", after.u === before.u, `-> ${before.u} -> ${after.u}`);
  const bw = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).bwUnit, KEY);
  ok("the bodyweight unit was not collaterally flipped", bw === "lb", `-> bwUnit=${bw}`);
```

- [ ] **Step 2: Run both to verify they fail**

```bash
node test/superset-logic.test.js
node test/superset-ui.test.js j.html
```
Expected: the logic test fails on `a mixed-unit export gains a Units block`; the UI test may fail on `found the other unit button` if the Manage unit control does not use `aria-pressed` — if so, read the control's actual markup and adjust the SELECTOR in the test, not the app.

- [ ] **Step 3: Write the implementation**

In **both** files, in `buildSheetRows`, insert immediately before `return rows;`:

```javascript
  /* Which unit each cycle was logged in. The grid's cells keep each set's
     native number — an export is a record of what was logged — so without
     this the sheet would silently mix kg and lb. Omitted when there is only
     one unit, keeping a single-unit export identical to before. */
  const uRows = cycleViews(data).map((v) => {
    const rec = (data.cycleHistory || []).find((c) => c.number === v.number);
    return [v.name, v.isCurrent ? (data.unit || "kg") : ((rec && rec.unit) || data.unit || "kg")];
  });
  if (new Set(uRows.map((r) => r[1])).size > 1) {
    rows.push([], ["Units"], ["Cycle", "Unit"]);
    uRows.forEach((r) => rows.push(r));
  }
```

- [ ] **Step 4: Run both tests to verify they pass**

```bash
node test/superset-logic.test.js
node test/superset-ui.test.js j.html
node test/superset-ui.test.js index.html
```
Expected: all pass.

- [ ] **Step 5: Verify continuity against the real blob shape**

```bash
node -e '
const path=require("path"), os=require("os");
const load=require("./test/harness.js");
const M=load(path.join(process.cwd(),"j.html"),["migrateUnits","volumeOf","fmtVol","cycleViews"],os.tmpdir());
const sets=(w,n)=>Array.from({length:n},()=>({w,r:10}));
const d={version:1,unit:"lb",bwUnit:"lb",weights:{},sentNotes:[],noteAcks:{},deloadWeeks:[],deloadPlan:{},
 userName:"JT",nameAsked:true,theme:"iron",rewardId:"gold-star",
 cycleHistory:[{number:2,name:"Cycle 2",start:"2026-06-15",end:"2026-09-21",weeks:15,deloadWeeks:[]}],
 cycleNumber:3,cycleName:"Cycle 3",cycleStart:"2026-09-22",cycleWeeks:14,exercises:[],
 sessions:{
  "2026-09-15|Tuesday":{date:"2026-09-15",day:"Tuesday",entries:{a:{variantId:"main",note:"",swapName:"",sets:sets(70,6)}}},
  "2026-09-22|Tuesday":{date:"2026-09-22",day:"Tuesday",entries:{a:{variantId:"main",note:"",swapName:"",sets:sets(154,6)}}}}};
M.migrateUnits(d);
const a=M.volumeOf(d.sessions["2026-09-15|Tuesday"].entries.a.sets);
const b=M.volumeOf(d.sessions["2026-09-22|Tuesday"].entries.a.sets);
console.log("70kg x 6 sets x 10 reps  =", M.fmtVol(a,"lb"));
console.log("154lb x 6 sets x 10 reps =", M.fmtVol(b,"lb"));
console.log("ratio:", (b/a).toFixed(3), "-- should be ~1.000; 154lb is 70kg");
'
```

Expected: both print close to the same lb figure and the ratio is ~1.000 — 154 lb *is* 70 kg, so a session logged either way must produce the same volume. Paste the output into your report.

- [ ] **Step 6: Verify both files compile, then commit**

```bash
git add test/superset-logic.test.js test/superset-ui.test.js index.html j.html
git commit -m "Record each cycle's unit in the CSV export

Grid cells keep each set's native number, so without this the sheet
silently mixes kg and lb. A Units block (Cycle | Unit) makes it
self-describing, and is omitted when every cycle shares one unit so a
single-unit export is unchanged.

Also asserts the property the whole change exists for: switching unit
re-scales what is displayed and leaves every stored weight and stamp
untouched, and 154lb x N produces the same canonical volume as 70kg x N."
```

---

## Task 6: Phase 2 — navigate the Log across cycles

**Files:**
- Modify: `index.html` (`TodayView`'s week indexing and its six `wIdx` consumers; `dayWeekStatus` gains a view-scoped form), `j.html` (same)
- Test: `test/superset-ui.test.js`

**Interfaces:**
- Consumes: `cycleViews`, `viewFor`, `weekIn`, `daySessionInView`, `isDeloadWeekIn`, `exListForView`, `cellDateFor` (all existing from the supersets work).
- Produces: no new exported names.

**The defect:** `wIdx = Math.min(maxWeek, Math.max(0, curWeek + weekOffset))` is a week index *within the live cycle*, floored at 0, and `‹` disables at `wIdx <= 0`. Cycle 2 is unreachable from the Log tab.

- [ ] **Step 1: Write the failing test**

In `test/superset-ui.test.js`, add a new block at the end, before the final `ok("no page errors across the run", ...)`. It needs a blob with an archived cycle holding a session, so build it inline and reload:

```javascript
  /* The Log tab must reach earlier cycles. Seed an archived cycle with a
     session in it, then walk back with the ‹ button. */
  const archived = {
    version: 1, unit: "lb", userName: "T", nameAsked: true, theme: "iron",
    rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
    deloadWeeks: [], deloadPlan: {},
    cycleHistory: [{ number: 1, name: "Cycle 1", start: FX.ago(56, FD.date),
                     end: FX.ago(14, FD.date), weeks: 6, deloadWeeks: [], unit: "kg" }],
    cycleNumber: 2, cycleName: "Cycle 2", cycleWeeks: 8, cycleStart: FX.ago(13, FD.date),
    exercises: [{ id: "a", day: FD.day, name: "Old Press", prev: 70, targetSets: 2, repGoal: 10,
                  variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" }],
    sessions: {
      [`${FX.ago(21, FD.date)}|${FD.day}`]: {
        date: FX.ago(21, FD.date), day: FD.day, celebrated: true,
        entries: { a: { variantId: "main", note: "", swapName: "",
          sets: [{ w: 70, r: 12, extra: false, tag: "", u: "kg" },
                 { w: 70, r: 10, extra: false, tag: "", u: "kg" }] } },
      },
    },
  };
  await page.evaluate((k, v) => { localStorage.clear(); localStorage.setItem(k, v); }, KEY, JSON.stringify(archived));
  await page.goto(`http://localhost:8777/${FILE}`, { waitUntil: "networkidle2" });
  await wait(1600);

  const prevWeek = () => page.evaluate(() => {
    const el = document.querySelector('button[aria-label="previous week"]');
    if (!el || el.disabled) return false; el.click(); return true;
  });
  let walked = 0;
  for (let i = 0; i < 6; i++) { if (await prevWeek()) { walked++; await wait(350); } else break; }
  ok("the ‹ button walks back more than the live cycle allows", walked >= 3,
     `-> walked back ${walked} weeks`);
  const label = await page.evaluate(() => document.body.innerText);
  ok("the label names the earlier cycle", /Cycle 1/.test(label),
     `-> ${(label.match(/Cycle \d[^\n]*/) || ["(none)"])[0]}`);
  ok("that cycle's logged session is reachable", /Old Press/.test(label));
  ok("Start Workout stays hidden in a past week", !/Start Workout/.test(label));
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node test/superset-ui.test.js j.html
```
Expected: FAIL on `the ‹ button walks back more than the live cycle allows` — it stops at week 0 of cycle 2, so `walked` is 1 or 2.

- [ ] **Step 3: Resolve the viewed week by date, not by live-cycle index**

In **both** files, in `TodayView`, replace:

```javascript
  const [weekOffset, setWeekOffset] = useState(0);
  const curWeek = Math.max(0, weekOfCycle(data, todayISO()));
  const maxWeek = Math.max((data.cycleWeeks || 8) - 1, curWeek);
  const wIdx = Math.min(maxWeek, Math.max(0, curWeek + weekOffset));
  const existing = daySessionIn(data, day, wIdx);
  const dateFor = existing ? existing.date : cellDateFor(data.cycleStart, wIdx, day);
  const sessionKey = existing ? existing.key : `${dateFor}|${day}`;
  const isDeload = isDeloadWeek(data, wIdx);
  const exList = exListFor(data, day, wIdx);
```

with:

```javascript
  const [weekOffset, setWeekOffset] = useState(0);
  /* Navigate by DATE, not by an index inside the live cycle: a week index
     floored at 0 made every earlier cycle unreachable. Resolve the week's
     date first, then ask which cycle owns it. */
  const views = cycleViews(data);
  const curWeek = Math.max(0, weekOfCycle(data, todayISO()));
  const maxWeek = Math.max((data.cycleWeeks || 8) - 1, curWeek);
  /* Anchor on the SELECTED day's date in the offset week, so the anchor is
     the very date we are about to render — not some other weekday's. */
  const weekAnchor = addDays(cellDateFor(data.cycleStart, curWeek, day), weekOffset * 7);
  /* Cycles are contiguous, so viewFor normally hits. It can miss only past
     both ends: clamp to the earliest or latest cycle accordingly. */
  const wView = viewFor(views, weekAnchor) ||
    (weekAnchor < views[0].start ? views[0] : views[views.length - 1]);
  const wIdx = Math.max(0, weekIn(wView, weekAnchor));
  const existing = daySessionInView(data, wView, day, wIdx);
  const dateFor = existing ? existing.date : cellDateFor(wView.start, wIdx, day);
  const sessionKey = existing ? existing.key : `${dateFor}|${day}`;
  const isDeload = isDeloadWeekIn(wView, wIdx);
  const exList = exListForView(data, wView, day, wIdx);
  /* Backward limit is week 0 of the EARLIEST cycle, not week 0 of the live
     one. Comparing dates would be wrong: the anchor is the selected weekday,
     which can sit after a cycle's Monday start inside week 0. Forward stays
     capped at the live cycle's planned length. */
  const atEarliest = wView.number === views[0].number && wIdx <= 0;
  const atLatest = wView.isCurrent && wIdx >= maxWeek;
```

- [ ] **Step 4: Re-point the navigation buttons and the label**

Replace the `‹` button's guard:

```javascript
        <button className="ll-chip ll-day" disabled={wIdx <= 0} aria-label="previous week"
          style={{ opacity: wIdx <= 0 ? 0.35 : 1 }}
```

with:

```javascript
        <button className="ll-chip ll-day" disabled={atEarliest} aria-label="previous week"
          style={{ opacity: atEarliest ? 0.35 : 1 }}
```

and the `›` button's:

```javascript
        <button className="ll-chip ll-day" disabled={wIdx >= maxWeek} aria-label="next week"
          style={{ opacity: wIdx >= maxWeek ? 0.35 : 1 }}
```

with:

```javascript
        <button className="ll-chip ll-day" disabled={atLatest} aria-label="next week"
          style={{ opacity: atLatest ? 0.35 : 1 }}
```

Then the label. Replace:

```javascript
            Cycle {data.cycleNumber} · Week {wIdx + 1}{isDeload ? " · ☾ deload" : ""}
```

with:

```javascript
            {wView.name} · Week {wIdx + 1}{isDeload ? " · ☾ deload" : ""}
```

- [ ] **Step 5: Give the day pills the resolved view**

`dayWeekStatus(data, d, wArg)` resolves sessions through `daySessionIn`, which uses the live cycle. Add a view parameter. In **both** files, change its signature and body:

```javascript
function dayWeekStatus(data, d, wArg, viewArg) {
  const today = todayISO();
  const view = viewArg || { number: data.cycleNumber, name: data.cycleName, start: data.cycleStart,
                            end: null, weeks: data.cycleWeeks || 8,
                            deloadWeeks: data.deloadWeeks || [], isCurrent: true };
  const w = wArg !== undefined ? wArg : Math.max(0, weekIn(view, today));
  const sess = daySessionInView(data, view, d, w);
```

and replace every remaining `daySessionIn(data, ...)` / `isDeloadWeek(data, ...)` / `exListFor(data, ...)` inside `dayWeekStatus` with the `*In`/`*View` form taking `view`. Leave the rest of its logic — the star/dot/✕/optional semantics — exactly as it is.

Then in `TodayView`'s day-pill map, pass the resolved view:

```javascript
          const st = dayWeekStatus(data, d, wIdx, wView);
```

`CycleGrid` already calls `dayWeekStatus` with its own view available; pass it there too so both callers agree.

- [ ] **Step 6: Keep Start/Finish out of past weeks**

Both are already gated on `weekOffset === 0`, which remains correct: a non-zero offset is never the live week. No change needed. Confirm by grepping:

```bash
grep -n "weekOffset === 0" index.html
```
Expected: three hits — the sticky bar, Start Workout, and the Finish button.

- [ ] **Step 7: Run the test to verify it passes**

```bash
node test/superset-ui.test.js j.html
node test/superset-ui.test.js index.html
```
Expected: PASS on both.

- [ ] **Step 8: Re-run every suite**

```bash
node test/superset-logic.test.js
node test/superset-render.test.js
node test/logging-regression.test.js j.html
node test/logging-regression.test.js index.html
```
Expected: all pass. `logging-regression` exercises the live week only, so it must stay at 16.

- [ ] **Step 9: Verify both files compile, then commit**

```bash
git add test/superset-ui.test.js index.html j.html
git commit -m "Let the Log tab navigate into earlier cycles

TodayView indexed weeks inside the live cycle and floored the index at 0,
so every archived cycle was unreachable from the Log tab even though
Progress could page back to them.

It now resolves the viewed week's DATE and asks which cycle owns it,
reusing cycleViews/viewFor/daySessionInView from the supersets work. The
six consumers of wIdx move to their view-scoped forms, dayWeekStatus
takes the resolved view so the day pills agree, and the backward limit
becomes the earliest cycle's start. Start and Finish stay gated on
weekOffset === 0, so a past week is for reading and correcting only."
```

---

## Task 7: Parity, full suite, and visual confirmation

**Files:** none (verification only, unless parity fails)

- [ ] **Step 1: Verify the new code is identical across both files**

```bash
python3 - <<'PY'
import re, difflib
names = ["kgOf", "toUnit", "volumeOf", "migrateUnits", "fmtVol", "setsLine",
         "SetRow", "dayWeekStatus", "buildSheetRows", "TodayView"]
out = {}
for f in ("index.html", "j.html"):
    lines = open(f).read().split("\n")
    got = []
    for n in names:
        idx = [i for i, l in enumerate(lines) if re.match(rf"(const|function) {n}\b", l)]
        assert len(idx) == 1, (f, n, len(idx))
        s = idx[0]
        e = next(i for i in range(s + 1, len(lines)) if lines[i] in ("}", "};"))
        got.append("\n".join(lines[s:e + 1]))
    out[f] = "\n\n".join(got)
same = out["index.html"] == out["j.html"]
print("unit code identical across both files:", same)
if not same:
    print("\n".join(list(difflib.unified_diff(
        out["index.html"].split("\n"), out["j.html"].split("\n"),
        "index", "j", lineterm=""))[:60]))
PY
```

Expected: `True`. `SEED_UNIT` is deliberately excluded from this list — it is the one line that differs.

- [ ] **Step 2: Verify `SEED_UNIT` differs, and the rest of the table is intact**

```bash
grep -h "^const SEED_UNIT" index.html j.html
for k in STORAGE_KEY REFEED_ROTATION PARTNER_NAME; do
  echo "-- $k"; grep -h "^const $k" index.html j.html
done
```

Expected: `"lb"` for index.html and `"kg"` for j.html, and the other three unchanged.

- [ ] **Step 3: Run the whole suite**

```bash
python3 -m http.server 8777 >/dev/null 2>&1 &
node test/superset-logic.test.js
node test/superset-render.test.js
node test/logging-regression.test.js j.html
node test/logging-regression.test.js index.html
node test/superset-ui.test.js j.html
node test/superset-ui.test.js index.html
pkill -f "http.server 8777"
```

Expected: every script exits 0.

- [ ] **Step 4: Confirm the reported defect is gone, on real-shaped data**

Seed a blob with a kg cycle and an lb cycle holding equivalent work, open Progress on All time, and read the volume series. The two cycles' weekly volumes should be comparable rather than the lb weeks appearing ~2.2× the kg ones. Screenshot it, Read the image, and confirm there is no step at the boundary.

- [ ] **Step 5: Report and stop**

Do **not** push. Summarise: what shipped, suite counts, the continuity evidence from Task 5 Step 5 and Task 7 Step 4, and that Phase 2 navigation works. Ask whether to merge and deploy.

---

## Self-Review

**Spec coverage.** Data model (`set.u`, `cycleHistory[i].unit`) → Tasks 1–3. Migration incl. `SEED_UNIT` per build, idempotency, `ex.prevU`, weightless rows → Task 2. Canonical `volumeOf` as the single conversion point → Task 1. `SetRow` target canonical → Task 4. `fmtVol`/`setsLine` conversion across all 14 call sites → Task 4. The editable-input exception and the column header → Task 4 Step 6. CSV `Units` block → Task 5. Phase 2 navigation incl. the six `wIdx` consumers, `dayWeekStatus`, the backward limit and Start/Finish gating → Task 6. Parity and the differences-table carve-out → Task 7.

Spec items deliberately **not** in this plan, matching its Out of Scope: rewriting stored `w` values, per-set unit editing UI, and `bwUnit`.

**Placeholders.** None. Two steps intentionally instruct the implementer to adapt a *test selector* to the app's real markup rather than guess it (Task 5 Step 2's unit-button selector, and Task 4 Step 8's note about volume strings now carrying units) — in both cases the plan states which side must change and why.

**Type consistency.** `kgOf(set)`, `toUnit(kg, unit)`, `volumeOf(sets)`, `migrateUnits(d)`, `SEED_UNIT`, `fmtVol(kg, unit)`, `setsLine(sets, unit)`, `sessionUnit`, `dayWeekStatus(data, d, wArg, viewArg)` are used with those exact names and arities in every later task. `cycleHistory[i].unit` is written in Task 2 and read in Tasks 3, 5 and 6.

**Three defects found in my own Task 6 during this review, fixed inline.**
The week anchor used `DAYS[0]` rather than the selected `day`, so it could
resolve a different weekday's date than the one about to render.
`viewFor`'s fallback went to the live cycle even when the anchor was
*before* every cycle, which would have jumped forward instead of clamping
back. And `atEarliest` compared the anchor date against the earliest
cycle's `start` — wrong, because the anchor is the selected weekday and can
sit after a Monday start while still inside week 0, which would have let
`‹` step past the earliest cycle into an unresolvable date. It now tests the
cycle identity and week index directly.

**One risk called out for the executor.** Task 4 is the task most likely to be finished half-way, because `fmtVol` and `setsLine` have 14 call sites between them and a missed one fails silently — printing kg where lb is meant. Step 9 is a grep that catches exactly that, and it is not optional.
