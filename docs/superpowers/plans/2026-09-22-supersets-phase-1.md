# Supersets Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log a superset as one connected card with round-interleaved sets, and create the pairing from Manage with a chain link between adjacent exercises.

**Architecture:** One optional `supersetId` field on an exercise groups members; rounds are the existing `targetSets` kept in sync across members, so all downstream set-counting math is untouched. Session entries stay keyed by exercise id, preserving per-exercise-per-machine comparisons. `ExerciseCard`'s entry logic is lifted verbatim into a `useExerciseEntry` hook that both `ExerciseCard` and the new `SupersetCard` consume.

**Tech Stack:** React 18 UMD + Babel-standalone, JSX inside a single `<script type="text/babel">` per HTML file. No bundler. Tests are plain Node scripts using esbuild (via npx) to compile the in-page script, plus react-dom/server for render assertions and puppeteer-core driving the installed Chrome for UI assertions.

**Spec:** `docs/superpowers/specs/2026-09-22-supersets-design.md`

## Global Constraints

- **Every change lands in BOTH `index.html` and `j.html`.** Supersets are not in the intentional-differences table, so the new code must be byte-identical across the two files. Verify with the parity check in Task 6.
- **Never change a `STORAGE_KEY`.** `index.html` is `franco-fit-a-v2`, `j.html` is `franco-fit-j-v1`.
- **Never edit, copy or sync `CELEBRATIONS`, `RAW`, seed functions, or anything in the CLAUDE.md differences table.**
- **Semantic colours are sacred:** `T.pos` = beat previous, `T.neg` = down, `T.amber` = tie/no comparison, `T.blue` = today/timer accent. Superset chrome must use `T.line` (rail, border) and `T.muted` (tag) only. Never introduce amber as a superset accent.
- **Comparisons are always per exercise per machine** via `lastEntryFor(data, exId, variantId, excludeKey, beforeDate)`. Nothing in this plan may compare or merge volume across superset members.
- **No seed change and no load-path migration.** Absent `supersetId` is the correct default for every existing user.
- Both files must compile clean after every task:
  ```bash
  node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');fs.writeFileSync('/tmp/a.jsx',h.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/)[1])" && npx --yes esbuild /tmp/a.jsx --loader:.jsx=jsx --outfile=/dev/null
  node -e "const fs=require('fs');const h=fs.readFileSync('j.html','utf8');fs.writeFileSync('/tmp/j.jsx',h.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/)[1])" && npx --yes esbuild /tmp/j.jsx --loader:.jsx=jsx --outfile=/dev/null
  ```
- Commit after every task. Do not push; deploying to `main` is the user's call.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `index.html` | Version A app, full source | Modify — all feature code |
| `j.html` | Version J app, full source | Modify — identical feature code |
| `test/harness.js` | Loads the in-page script out of an HTML file and returns its top-level functions | Create (Task 1) |
| `test/superset-logic.test.js` | Pure grouping + link/unlink/move assertions | Create (Task 1, extended Task 2) |
| `test/superset-render.test.js` | react-dom/server assertions on `SupersetCard` | Create (Task 4) |
| `test/logging-regression.test.js` | Real-Chrome single-exercise logging, guards the hook refactor | Create (Task 3) |
| `test/superset-ui.test.js` | Real-Chrome link → log a round → unlink | Create (Task 5) |
| `test/package.json` | devDependencies for the test scripts only | Create (Task 1) |
| `test/README.md` | Says the app itself still has no build step | Create (Task 1) |

The app stays two self-contained HTML files with no build step. `test/` is tooling for verification only and is never referenced by the app.

---

### Task 1: Test scaffold and `groupedExercises`

**Files:**
- Create: `test/package.json`, `test/README.md`, `test/harness.js`, `test/superset-logic.test.js`
- Modify: `index.html` (insert helpers after `daySessionInView`), `j.html` (same)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `supersetRounds(members) -> number` — max of members' `targetSets`, min 1.
  - `groupedExercises(list) -> Array<{kind:"single", ex} | {kind:"superset", id, rounds, members}>`
  - `test/harness.js` default export `load(htmlPath, names, tmpdir) -> object` mapping each requested top-level name to its value.

- [ ] **Step 1: Create the test scaffold**

`test/package.json`:

```json
{
  "name": "fanco-fit-tests",
  "private": true,
  "description": "Verification scripts only. The app itself has no build step.",
  "devDependencies": {
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "puppeteer-core": "23.11.1"
  }
}
```

`test/README.md`:

```markdown
# Tests

Verification scripts for `index.html` and `j.html`. **The app itself still has
no build step** — these scripts never run in the browser and nothing in the
HTML files imports them.

    cd test && npm install

- `superset-logic.test.js` — pure helpers, run with `node`
- `superset-render.test.js` — react-dom/server render assertions
- `logging-regression.test.js` — real Chrome, single-exercise logging
- `superset-ui.test.js` — real Chrome, link/log/unlink

The Chrome tests need a local server and the installed Google Chrome:

    python3 -m http.server 8777     # from the repo root
    node test/logging-regression.test.js j.html
```

`test/harness.js`:

```javascript
/* Loads the real shipped script out of an HTML file and returns its top-level
   values, so tests exercise the deployed code rather than a copy of it. */
const fs = require("fs");
const cp = require("child_process");
const path = require("path");

module.exports = function load(htmlPath, names, tmpdir) {
  const html = fs.readFileSync(htmlPath, "utf8");
  let body = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
  /* drop the single top-level side effect: the React mount */
  body = body.replace(/ReactDOM\.createRoot\([\s\S]*?\);\s*$/, "");
  body += `\nmodule.exports = { ${names.join(", ")} };\n`;
  const jsx = path.join(tmpdir, path.basename(htmlPath) + ".probe.jsx");
  const out = path.join(tmpdir, path.basename(htmlPath) + ".probe.js");
  fs.writeFileSync(jsx, body);
  cp.execFileSync("npx", ["--yes", "esbuild", jsx, "--loader:.jsx=jsx",
    "--format=cjs", "--platform=node", "--jsx-factory=h", "--jsx-fragment=Frag",
    "--outfile=" + out], { stdio: "pipe" });

  const store = {};
  global.h = () => null;
  global.Frag = null;
  global.React = {
    useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }),
    useMemo: (f) => f(), useCallback: (f) => f, createElement: () => null, Fragment: null,
  };
  global.ReactDOM = { createRoot: () => ({ render: () => {} }) };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  global.document = {
    getElementById: () => null,
    documentElement: { style: { setProperty() {} } },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }),
    head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} },
  };
  global.window = global;
  global.fetch = () => Promise.resolve({ ok: false, json: () => ({}) });
  global.navigator = { userAgent: "node" };
  global.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  return require(out);
};
```

Then:

```bash
cd test && npm install && cd ..
```

- [ ] **Step 2: Write the failing test**

`test/superset-logic.test.js`:

```javascript
/* Pure superset grouping. Runs against the real script in both HTML files. */
const path = require("path");
const os = require("os");
const load = require("./harness.js");

const REPO = path.join(__dirname, "..");
const API = ["groupedExercises", "supersetRounds"];

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(ok ? `  ok   ${name}` :
    `FAIL   ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};

/* Minimal exercise shape: only the fields grouping reads. */
const ex = (id, targetSets, supersetId) => ({
  id, day: "Tuesday", name: id, targetSets,
  ...(supersetId ? { supersetId } : {}),
  variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main",
});
/* Compact view of a grouping result, for readable assertions. */
const shape = (groups) => groups.map((g) =>
  g.kind === "single" ? ["single", g.ex.id] : ["superset", g.id, g.rounds, g.members.map((m) => m.id)]);

for (const file of ["index.html", "j.html"]) {
  console.log(`\n== ${file} ==`);
  const M = load(path.join(REPO, file), API, os.tmpdir());

  eq("no supersets -> all singles",
     shape(M.groupedExercises([ex("a", 3), ex("b", 3)])),
     [["single", "a"], ["single", "b"]]);

  eq("adjacent pair groups",
     shape(M.groupedExercises([ex("a", 4, "s1"), ex("b", 4, "s1"), ex("c", 3)])),
     [["superset", "s1", 4, ["a", "b"]], ["single", "c"]]);

  eq("triset groups",
     shape(M.groupedExercises([ex("a", 3, "s1"), ex("b", 3, "s1"), ex("c", 3, "s1")])),
     [["superset", "s1", 3, ["a", "b", "c"]]]);

  /* Grouping by first appearance: a non-member wedged between two members
     must not split the group, and the group holds the first member's slot. */
  eq("members separated by a non-member still group, at the first slot",
     shape(M.groupedExercises([ex("a", 3, "s1"), ex("x", 3), ex("b", 3, "s1")])),
     [["superset", "s1", 3, ["a", "b"]], ["single", "x"]]);

  eq("group reduced to one member collapses to a single",
     shape(M.groupedExercises([ex("a", 3, "s1"), ex("c", 3)])),
     [["single", "a"], ["single", "c"]]);

  eq("two independent groups",
     shape(M.groupedExercises([ex("a", 3, "s1"), ex("b", 3, "s1"), ex("c", 2, "s2"), ex("d", 2, "s2")])),
     [["superset", "s1", 3, ["a", "b"]], ["superset", "s2", 2, ["c", "d"]]]);

  eq("divergent targetSets reconcile to the max",
     shape(M.groupedExercises([ex("a", 4, "s1"), ex("b", 3, "s1")])),
     [["superset", "s1", 4, ["a", "b"]]]);

  eq("empty list", shape(M.groupedExercises([])), []);

  eq("supersetRounds takes the max", M.supersetRounds([ex("a", 2), ex("b", 5)]), 5);
  eq("supersetRounds floors at 1", M.supersetRounds([ex("a", 0), ex("b", 0)]), 1);
  eq("supersetRounds defaults a missing targetSets to 3",
     M.supersetRounds([{ id: "a" }, { id: "b" }]), 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node test/superset-logic.test.js`
Expected: FAIL — `ReferenceError: groupedExercises is not defined` thrown from the harness's generated `module.exports` line.

- [ ] **Step 4: Write the implementation**

In **both** `index.html` and `j.html`, insert the following immediately after the closing brace of `daySessionInView` (search for `function daySessionInView(data, view, day, w) {` and insert after its closing `}`):

```javascript

/* ---- Supersets -----------------------------------------------------
   A superset is a grouping over the flat exercise list, nothing more:
   members share a `supersetId`, and session entries stay keyed by
   exercise id so every comparison remains per exercise per machine.
   Rounds are the members' shared `targetSets` — there is deliberately
   no second source of truth for the round count. */

/* Round count for a group. Members are kept in sync when linking and by
   the group stepper; max() is the safety net for a hand-edited or
   restored blob whose members drifted apart. */
const supersetRounds = (members) =>
  Math.max(1, ...members.map((m) => m.targetSets || 3));

/* Lay a day's exercise list out as singles and superset groups.
   Grouped by FIRST APPEARANCE rather than by consecutive runs: a reorder
   that separated two members would silently split a run-based group. A
   group that ends up with one member (its partner was deleted) collapses
   back to a plain single, so half a pair can never render as a group. */
function groupedExercises(list) {
  const out = [];
  const byId = {};
  for (const ex of list) {
    if (!ex.supersetId) { out.push({ kind: "single", ex }); continue; }
    if (!byId[ex.supersetId]) {
      byId[ex.supersetId] = { kind: "superset", id: ex.supersetId, members: [] };
      out.push(byId[ex.supersetId]);
    }
    byId[ex.supersetId].members.push(ex);
  }
  return out.map((g) => {
    if (g.kind !== "superset") return g;
    if (g.members.length < 2) return { kind: "single", ex: g.members[0] };
    return { ...g, rounds: supersetRounds(g.members) };
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node test/superset-logic.test.js`
Expected: PASS — `0 failed`. Record the actual assertion count in your report; the gate is zero failures, not a specific total.

- [ ] **Step 6: Verify both files still compile**

Run the two esbuild commands from Global Constraints.
Expected: both print a size line and `Done`, no errors.

- [ ] **Step 7: Commit**

```bash
git add test index.html j.html
git commit -m "Add superset grouping helpers and a test scaffold

groupedExercises lays a day's list out as singles and superset groups,
grouped by first appearance so a reorder cannot split a pair, with a
one-member group collapsing back to a single. Rounds derive from the
members' shared targetSets.

test/ holds verification scripts only; the app still has no build step."
```

---

### Task 2: Link, unlink and group-move mutations

**Files:**
- Modify: `index.html` (insert after `groupedExercises`), `j.html` (same)
- Test: `test/superset-logic.test.js` (extend)

**Interfaces:**
- Consumes: `groupedExercises`, `supersetRounds` (Task 1).
- Produces, all operating in place on a day's exercise array and returning a
  result object for the caller's confirmation message:
  - `linkSuperset(list, idA, idB) -> { id, raised: [{name, from, to}] }`
  - `unlinkSuperset(list, supersetId) -> void`
  - `setSupersetRounds(list, supersetId, rounds) -> void`
  - `moveExerciseGroup(list, day, key, dir) -> void` — moves a whole group one
    slot within its day. `key` is a `supersetId` for a group or an exercise id
    for a lone exercise; `dir` is `-1` or `1`. Day-scoped, because
    `mutListFor(d, day)` hands back the **whole cross-day** `d.exercises` array
    in normal mode and only that day's plan in deload mode.

- [ ] **Step 1: Write the failing test**

Append to `test/superset-logic.test.js`, inside the `for (const file of ...)` loop, after the existing assertions (and add the four new names to `API` at the top of the file so it reads
`const API = ["groupedExercises", "supersetRounds", "linkSuperset", "unlinkSuperset", "setSupersetRounds", "moveExerciseGroup"];`):

```javascript
  /* ---- link ---- */
  {
    const list = [ex("a", 4), ex("b", 3), ex("c", 3)];
    const res = M.linkSuperset(list, "a", "b");
    eq("link puts both members in one group",
       shape(M.groupedExercises(list)),
       [["superset", res.id, 4, ["a", "b"]], ["single", "c"]]);
    eq("link raises the lower targetSets to the higher",
       list.map((e) => e.targetSets), [4, 4, 3]);
    eq("link reports what it raised", res.raised, [{ name: "b", from: 3, to: 4 }]);
    eq("link reports nothing raised when counts already match",
       M.linkSuperset([ex("d", 3), ex("e", 3)], "d", "e").raised, []);
  }

  /* ---- link onto an existing group makes a triset ---- */
  {
    const list = [ex("a", 3, "s1"), ex("b", 3, "s1"), ex("c", 5)];
    M.linkSuperset(list, "b", "c");
    eq("linking a neighbour onto a group joins that group",
       shape(M.groupedExercises(list)),
       [["superset", "s1", 5, ["a", "b", "c"]]]);
    eq("joining a group raises every member to the new max",
       list.map((e) => e.targetSets), [5, 5, 5]);
  }

  /* ---- unlink ---- */
  {
    const list = [ex("a", 4, "s1"), ex("b", 4, "s1"), ex("c", 3)];
    M.unlinkSuperset(list, "s1");
    eq("unlink leaves independent singles",
       shape(M.groupedExercises(list)),
       [["single", "a"], ["single", "b"], ["single", "c"]]);
    eq("unlink leaves targetSets alone", list.map((e) => e.targetSets), [4, 4, 3]);
    eq("unlink clears the field rather than blanking it",
       list.every((e) => !("supersetId" in e)), true);
  }

  /* ---- rounds stepper writes every member ---- */
  {
    const list = [ex("a", 3, "s1"), ex("b", 3, "s1"), ex("c", 3)];
    M.setSupersetRounds(list, "s1", 5);
    eq("rounds stepper writes all members, not the loose exercise",
       list.map((e) => e.targetSets), [5, 5, 3]);
    M.setSupersetRounds(list, "s1", 0);
    eq("rounds stepper floors at 1", list.map((e) => e.targetSets), [1, 1, 3]);
  }

  /* ---- group moves as a block, scoped to its day ---- */
  {
    const list = [ex("x", 3), ex("a", 3, "s1"), ex("b", 3, "s1"), ex("y", 3)];
    M.moveExerciseGroup(list, "Tuesday", "s1", -1);
    eq("group moves up past the exercise above it",
       list.map((e) => e.id), ["a", "b", "x", "y"]);
    M.moveExerciseGroup(list, "Tuesday", "s1", 1);
    eq("group moves back down as a block",
       list.map((e) => e.id), ["x", "a", "b", "y"]);
    M.moveExerciseGroup(list, "Tuesday", "s1", 1);
    eq("group moves down past the exercise below it",
       list.map((e) => e.id), ["x", "y", "a", "b"]);
    M.moveExerciseGroup(list, "Tuesday", "s1", 1);
    eq("moving the last group down is a no-op",
       list.map((e) => e.id), ["x", "y", "a", "b"]);
    M.moveExerciseGroup(list, "Tuesday", "s1", -1);
    M.moveExerciseGroup(list, "Tuesday", "s1", -1);
    M.moveExerciseGroup(list, "Tuesday", "s1", -1);
    eq("moving the first group up is a no-op",
       list.map((e) => e.id), ["a", "b", "x", "y"]);
  }

  /* A single exercise moves by group too, so it can never be dropped into
     the middle of a superset. */
  {
    const list = [ex("a", 3, "s1"), ex("b", 3, "s1"), ex("y", 3)];
    M.moveExerciseGroup(list, "Tuesday", "y", -1);
    eq("a lone exercise hops the whole group, not into it",
       list.map((e) => e.id), ["y", "a", "b"]);
  }

  /* mutListFor hands back the whole cross-day array in normal mode, so the
     move must rewrite only this day's slots. */
  {
    const other = (id) => ({ ...ex(id, 3), day: "Friday" });
    const list = [other("f1"), ex("a", 3, "s1"), other("f2"), ex("b", 3, "s1"),
                  other("f3"), ex("y", 3)];
    M.moveExerciseGroup(list, "Tuesday", "y", -1);
    eq("other days keep their exact positions",
       list.map((e) => e.id), ["f1", "y", "f2", "a", "f3", "b"]);
    eq("other days' exercises are untouched objects",
       list.filter((e) => e.day === "Friday").map((e) => e.id), ["f1", "f2", "f3"]);
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/superset-logic.test.js`
Expected: FAIL — `ReferenceError: linkSuperset is not defined`.

- [ ] **Step 3: Write the implementation**

In **both** files, insert after the closing brace of `groupedExercises`:

```javascript

/* Link two exercises in the same day's list into one group. If either is
   already in a group, the other joins it rather than starting a new one,
   which is how trisets get made. Round counts are reconciled UP: raising
   the shorter move is safer than silently dropping a planned set. Returns
   what changed so the caller can say so inline. */
function linkSuperset(list, idA, idB) {
  const a = list.find((e) => e.id === idA);
  const b = list.find((e) => e.id === idB);
  if (!a || !b || a === b) return { id: null, raised: [] };
  const id = a.supersetId || b.supersetId || `ss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  a.supersetId = id;
  b.supersetId = id;
  const members = list.filter((e) => e.supersetId === id);
  const rounds = supersetRounds(members);
  const raised = [];
  for (const m of members) {
    const from = m.targetSets || 3;
    if (from !== rounds) {
      raised.push({ name: m.name, from, to: rounds });
      m.targetSets = rounds;
    }
  }
  return { id, raised };
}

/* Break a group apart. Planned set counts stay where they are — the user
   chose those numbers, even if the group reconciled them. */
function unlinkSuperset(list, supersetId) {
  for (const e of list) {
    if (e.supersetId === supersetId) delete e.supersetId;
  }
}

/* The group's rounds stepper. Rounds live in targetSets, so this writes
   every member and nothing else. */
function setSupersetRounds(list, supersetId, rounds) {
  const n = Math.max(1, rounds);
  for (const e of list) {
    if (e.supersetId === supersetId) e.targetSets = n;
  }
}

/* Move a whole group — a superset, or a lone exercise — one slot within its
   day. `key` is a supersetId or an exercise id.

   Day scoping matters: mutListFor(d, day) returns the WHOLE cross-day
   d.exercises array in normal mode, and only that day's plan in deload
   mode. Filtering by e.day handles both, and only the slots this day
   already occupies get rewritten, so other days stay exactly where they
   are. Moving by group also means a loose exercise can never be dropped
   into the middle of a superset. */
function moveExerciseGroup(list, day, key, dir) {
  const slots = [];
  list.forEach((e, i) => { if (e.day === day) slots.push(i); });
  const groups = groupedExercises(slots.map((i) => list[i]));
  const keyOf = (g) => (g.kind === "superset" ? g.id : g.ex.id);
  const at = groups.findIndex((g) => keyOf(g) === key);
  if (at < 0) return;
  const to = at + dir;
  if (to < 0 || to >= groups.length) return;
  [groups[at], groups[to]] = [groups[to], groups[at]];
  const flat = [];
  for (const g of groups) {
    if (g.kind === "single") flat.push(g.ex);
    else flat.push(...g.members);
  }
  slots.forEach((slot, n) => { list[slot] = flat[n]; });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/superset-logic.test.js`
Expected: PASS — `0 failed`, with a higher total than Task 1's. Record the actual count in your report; the gate is zero failures.

- [ ] **Step 5: Verify both files still compile**

Run the two esbuild commands from Global Constraints. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add test/superset-logic.test.js index.html j.html
git commit -m "Add superset link, unlink, rounds and group-move mutations

Linking reconciles round counts upward and reports what it raised so the
UI can say so inline; linking onto an existing group joins it, which is
how trisets are made.

moveExerciseGroup moves a superset or a lone exercise one slot within its
day, rewriting only that day's slots — mutListFor hands back the whole
cross-day exercises array in normal mode, so an unscoped reorder would
have shuffled other days. Moving by group also stops a loose exercise
being dropped inside a superset."
```

---

### Task 3: Extract `useExerciseEntry` from `ExerciseCard`

This task adds no feature. It is a strictly behaviour-preserving refactor that
`SupersetCard` depends on, gated by a real-browser regression test on the
single-exercise logging path.

**Files:**
- Modify: `index.html` (`ExerciseCard`, currently starting at the line `function ExerciseCard({ data, update, ex, sessionKey, dayColor, isDeload }) {`), `j.html` (same)
- Test: `test/logging-regression.test.js`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `useExerciseEntry(data, update, ex, sessionKey, isDeload)` returning
  exactly:
  ```
  { exHome, entry, variantId, variant, lastSame, lastAny, ensureEntry,
    changeSet, addExtraSet, setSkipAll, removeSetAt, todaySets, skippedAll,
    hasLogged, plannedToday, exTotal, plannedFilled, exFilled, exComplete,
    todayVol, lastVol, liveDelta, beating, stripColor, bodyweight, lastLogged }
  ```

- [ ] **Step 1: Write the regression test**

`test/logging-regression.test.js`:

```javascript
/* Guards the useExerciseEntry extraction: single-exercise logging must behave
   exactly as before. Drives the real app in Chrome.
   Prereqs: `python3 -m http.server 8777` in the repo root. */
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FILE = process.argv[2] || "j.html";
const KEY = FILE === "j.html" ? "franco-fit-j-v1" : "franco-fit-a-v2";

let pass = 0, fail = 0;
const ok = (n, c, note = "") => { c ? pass++ : fail++; console.log(`${c ? "  ok  " : "FAIL  "} ${n} ${note}`); };

/* A day with one two-set exercise and history to compare against, so the
   target placeholder and green/red both have something to work from. */
const blob = {
  version: 1, unit: "kg", userName: "Test", nameAsked: true, theme: "iron",
  rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
  deloadWeeks: [], deloadPlan: {}, cycleHistory: [],
  cycleNumber: 1, cycleName: "Cycle 1", cycleWeeks: 8, cycleStart: "2026-09-07",
  exercises: [{
    id: "t-press", day: "Tuesday", name: "Test Press", prev: 80, targetSets: 2, repGoal: 10,
    variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main",
  }],
  sessions: {
    "2026-09-08|Tuesday": {
      date: "2026-09-08", day: "Tuesday", celebrated: true,
      entries: { "t-press": { variantId: "main", note: "", swapName: "",
        sets: [{ w: 100, r: 10, extra: false, tag: "" }, { w: 100, r: 8, extra: false, tag: "" }] } },
    },
  },
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 950, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`http://localhost:8777/${FILE}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((k, v) => { localStorage.clear(); localStorage.setItem(k, v); }, KEY, JSON.stringify(blob));
  await page.goto(`http://localhost:8777/${FILE}`, { waitUntil: "networkidle2" });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1500);

  const txt = () => page.evaluate(() => document.body.innerText);
  const clickText = (t) => page.evaluate((t) => {
    const els = [...document.querySelectorAll("button,[role=button]")];
    const el = els.find((b) => (b.textContent || "").trim() === t) ||
               els.find((b) => (b.textContent || "").includes(t));
    if (!el) return false; el.click(); return true;
  }, t);
  const reps = () => page.evaluate(() =>
    [...document.querySelectorAll('input[aria-label="reps"]')].map((i) => ({
      value: i.value, placeholder: i.placeholder, cls: i.className,
    })));
  const weights = () => page.evaluate(() =>
    [...document.querySelectorAll('input[aria-label="weight"]')].map((i) => i.value));
  const setInput = (sel, idx, val) => page.evaluate((sel, idx, val) => {
    const el = document.querySelectorAll(sel)[idx];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, sel, idx, val);

  console.log(`\n== ${FILE} · single-exercise logging regression ==`);
  ok("app boots on the Log tab", /Test Press/.test(await txt()));

  ok("exercise card opens", await clickText("Test Press")); await wait(500);
  ok("last time panel shows the prior session", /Last time/.test(await txt()));
  ok("two planned set rows laid out", (await reps()).length === 2, `-> ${(await reps()).length}`);

  /* the "beat last week" target: last set 1 was 100x10, so at 100kg the
     placeholder must ask for 11 */
  const before = await reps();
  ok("set 1 placeholder asks to beat last week", before[0].placeholder === "11+",
     `-> ${JSON.stringify(before[0].placeholder)}`);

  /* weight cascade: typing set 1's weight fills the blank set below */
  await setInput('input[aria-label="weight"]', 0, "105"); await wait(400);
  ok("weight cascades to the blank set below", (await weights())[1] === "105",
     `-> ${JSON.stringify(await weights())}`);

  /* green when beating the same set index on the same machine */
  await setInput('input[aria-label="reps"]', 0, "12"); await wait(400);
  ok("beating last week colours the reps green", /good/.test((await reps())[0].cls),
     `-> ${JSON.stringify((await reps())[0].cls)}`);

  /* red when down on the same set index */
  await setInput('input[aria-label="reps"]', 1, "2"); await wait(400);
  ok("falling short colours the reps red", /bad/.test((await reps())[1].cls),
     `-> ${JSON.stringify((await reps())[1].cls)}`);

  /* completion: both planned sets logged */
  await wait(300);
  ok("card reports today's volume once complete", /Today:/.test(await txt()));

  /* extra sets still append outside the planned total */
  ok("extra set button present", await clickText("+ Extra set")); await wait(500);
  ok("extra set appends a third row", (await reps()).length === 3, `-> ${(await reps()).length}`);

  /* skip all, then undo */
  ok("skip all works", await clickText("Skip all sets")); await wait(500);
  ok("skipped state shown", /Skipped today/.test(await txt()));
  ok("undo restores the sets", await clickText("Undo — do this exercise")); await wait(500);
  ok("rows return after undo", (await reps()).length >= 2);

  ok("no page errors across the run", errors.length === 0, errors[0] ? `-> ${errors[0].slice(0, 120)}` : "");

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run it against the CURRENT code to capture the baseline**

```bash
python3 -m http.server 8777 >/dev/null 2>&1 &
node test/logging-regression.test.js j.html
node test/logging-regression.test.js index.html
```

Expected: PASS on both, **before any refactor**. This is the point of the task —
the test must green on today's code so that a failure after the refactor is
unambiguously the refactor's fault. If anything fails here, stop and fix the
test, not the app.

- [ ] **Step 3: Commit the baseline test on its own**

```bash
git add test/logging-regression.test.js
git commit -m "Add single-exercise logging regression test

Captures the current behaviour of ExerciseCard's logging path — target
placeholder, weight cascade, per-set green/red, completion, extra sets,
skip-all — so the useExerciseEntry extraction can be proven behaviour
preserving rather than assumed to be."
```

- [ ] **Step 4: Extract the hook**

In **both** files, insert this immediately BEFORE the line
`function ExerciseCard({ data, update, ex, sessionKey, dayColor, isDeload }) {`.
Every expression below is lifted verbatim out of `ExerciseCard` — do not
reformulate any of it:

```javascript
/* Everything an exercise's log entry needs, independent of how it is laid
   out. ExerciseCard renders one of these; SupersetCard renders one per
   member of a group. Lifted wholesale out of ExerciseCard — the logic is
   unchanged, it just has two callers now. */
function useExerciseEntry(data, update, ex, sessionKey, isDeload) {
  /* The array this exercise actually lives in. Deload plan entries keep the
     program's ids, so writing to d.exercises during a deload week would
     mutate the real program instead of the plan. */
  const exHome = (d) => (isDeload ? ((d.deloadPlan || {})[ex.day] || d.exercises) : d.exercises);

  const session = data.sessions[sessionKey];
  const sessionDate = sessionKey.split("|")[0];
  const entry = session && session.entries[ex.id];
  const variantId = entry ? entry.variantId : ex.activeVariant;
  const variant = ex.variants.find((v) => v.id === variantId) || ex.variants[0];

  const lastSame = lastEntryFor(data, ex.id, variantId, sessionKey, sessionDate);
  const lastAny = lastEntryFor(data, ex.id, null, sessionKey, sessionDate);

  const ensureEntry = (d) => {
    if (!d.sessions[sessionKey]) {
      d.sessions[sessionKey] = { date: sessionKey.split("|")[0], day: ex.day, entries: {} };
    }
    if (!d.sessions[sessionKey].entries[ex.id]) {
      d.sessions[sessionKey].entries[ex.id] = {
        variantId: ex.activeVariant,
        sets: Array.from({ length: ex.targetSets || 3 }, () => ({ w: "", r: "", extra: false, tag: "" })),
        note: "",
        swapName: "",
      };
    }
    return d.sessions[sessionKey].entries[ex.id];
  };

  const changeSet = (i, ns) =>
    update((d) => {
      const e = ensureEntry(d);
      const oldW = String(e.sets[i].w ?? "");
      e.sets[i] = ns;
      /* Cascade weight down to blank/matching sets — but never cascade a clear */
      const newW = String(ns.w ?? "");
      if (newW !== oldW && newW !== "") {
        for (let j = i + 1; j < e.sets.length; j++) {
          const wj = String(e.sets[j].w ?? "");
          if (wj === "" || wj === oldW) e.sets[j] = { ...e.sets[j], w: ns.w };
        }
      }
    });

  const addExtraSet = () =>
    update((d) => {
      const e = ensureEntry(d);
      const lastWeighted = [...e.sets].reverse().find((s) => num(s.w) > 0);
      e.sets.push({ w: lastWeighted ? lastWeighted.w : "", r: "", extra: true, tag: "" });
    });

  const setSkipAll = (v) => update((d) => { ensureEntry(d).skippedAll = v; });
  const removeSetAt = (i) => update((d) => { ensureEntry(d).sets.splice(i, 1); });

  const todaySets = entry ? entry.sets : [];
  const skippedAll = !!(entry && entry.skippedAll);
  const hasLogged = !skippedAll && todaySets.some((s) => !s.skipped && (num(s.r) > 0 || num(s.w) > 0));
  const plannedToday = todaySets.filter((s) => !s.extra);
  const exTotal = Math.max(plannedToday.length, ex.targetSets || 3);
  const plannedFilled = plannedToday.filter((s) => num(s.r) > 0 || s.skipped).length;
  const extraFilled = todaySets.filter((s) => s.extra && num(s.r) > 0).length;
  const exFilled = skippedAll ? exTotal : plannedFilled + extraFilled;
  const exComplete = skippedAll || plannedFilled >= exTotal;
  const todayVol = scoreOf(todaySets);
  const lastVol = lastSame ? scoreOf(lastSame.entry.sets) : 0;
  const liveDelta = !isDeload && exComplete && !skippedAll && lastSame ? pct(lastVol, todayVol) : null;
  const beating = exComplete && liveDelta !== null && liveDelta > 0;
  const stripColor = !exComplete
    ? T.line
    : skippedAll ? "#565B63" : beating ? T.pos : liveDelta !== null && liveDelta < 0 ? T.neg : T.amber;

  const bodyweight = lastSame && isBodyweight(lastSame.entry.sets);
  /* Sets actually logged last time, positionally indexed — this is what a
     set row compares against. */
  const lastLogged = lastSame
    ? lastSame.entry.sets.filter((x) => num(x.r) > 0 || num(x.w) > 0)
    : [];

  return {
    exHome, entry, variantId, variant, lastSame, lastAny, ensureEntry,
    changeSet, addExtraSet, setSkipAll, removeSetAt, todaySets, skippedAll,
    hasLogged, plannedToday, exTotal, plannedFilled, exFilled, exComplete,
    todayVol, lastVol, liveDelta, beating, stripColor, bodyweight, lastLogged,
  };
}
```

- [ ] **Step 5: Rewire `ExerciseCard` to consume the hook**

In `ExerciseCard`, **delete** the block that now lives in the hook — everything
from the `const exHome = (d) => ...` line down to and including the
`const bodyweight = lastSame && isBodyweight(lastSame.entry.sets);` line, EXCEPT
the six `useState` declarations, the baked-in-sets `useEffect`, and the `burst`
`useState` / `prevCompleteRef` / burst `useEffect`, all of which stay in the
component. Replace the deleted derivations with:

```javascript
  const {
    exHome, entry, variantId, variant, lastSame, lastAny, ensureEntry,
    changeSet, addExtraSet, setSkipAll, removeSetAt, todaySets, skippedAll,
    plannedToday, exTotal, exFilled, exComplete, todayVol, lastVol,
    liveDelta, beating, stripColor, bodyweight, lastLogged,
  } = useExerciseEntry(data, update, ex, sessionKey, isDeload);
```

Then replace the three call sites that used the now-hoisted inline logic:

- The skip-all buttons: `onClick={() => update((d) => { ensureEntry(d).skippedAll = false; })}`
  becomes `onClick={() => setSkipAll(false)}`, and
  `onClick={() => update((d) => { ensureEntry(d).skippedAll = true; })}`
  becomes `onClick={() => setSkipAll(true)}`.
- The set list IIFE — replace
  ```jsx
              {(() => {
                const lastLogged = lastSame
                  ? lastSame.entry.sets.filter((x) => num(x.r) > 0 || num(x.w) > 0)
                  : [];
                return todaySets.map((s, i) => (
                  <SetRow key={i} idx={i} set={s} unit={data.unit} repGoal={ex.repGoal}
                    compareSet={isDeload || s.extra ? undefined : lastLogged[i]}
                    onChange={(ns) => changeSet(i, ns)}
                    onRemove={() => update((d) => { ensureEntry(d).sets.splice(i, 1); })} />
                ));
              })()}
  ```
  with
  ```jsx
              {todaySets.map((s, i) => (
                <SetRow key={i} idx={i} set={s} unit={data.unit} repGoal={ex.repGoal}
                  compareSet={isDeload || s.extra ? undefined : lastLogged[i]}
                  onChange={(ns) => changeSet(i, ns)}
                  onRemove={() => removeSetAt(i)} />
              ))}
  ```

Leave every other line of `ExerciseCard` — the header, the set-count pips, the
machine selector, the last-time panel, the note field — exactly as it is.

- [ ] **Step 6: Run the regression test to verify nothing changed**

```bash
node test/logging-regression.test.js j.html
node test/logging-regression.test.js index.html
```

Expected: PASS on both, with the same assertion count as the Step 2 baseline. Any
failure means the extraction changed behaviour — fix the extraction, do not
adjust the test.

- [ ] **Step 7: Verify both files still compile**

Run the two esbuild commands from Global Constraints. Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add index.html j.html
git commit -m "Extract useExerciseEntry from ExerciseCard

Behaviour-preserving lift of the entry, comparison, mutation and
completion logic so SupersetCard can reuse it per member. ExerciseCard
keeps its own useState, baked-in-sets effect and burst animation and is
otherwise unchanged; the logging regression test passes unchanged."
```

---

### Task 4: `SupersetCard` and the `TodayView` dispatch

**Files:**
- Modify: `index.html` (insert `SupersetCard` after `ExerciseCard`'s closing brace; change the `exList.map` in `TodayView`), `j.html` (same)
- Test: `test/superset-render.test.js`

**Interfaces:**
- Consumes: `groupedExercises`, `supersetRounds` (Task 1); `useExerciseEntry` (Task 3); `SetRow`, `Delta`, `Row`, `VariantDot`, `setsLine`, `fmtVol`, `fmtDate` (existing).
- Produces: `SupersetCard({ data, update, group, sessionKey, dayColor, isDeload })`.

**Layout note — a deviation from the approved mockup.** The mockup showed the
member name inline to the left of its inputs. `SetRow` is already about 300px
wide (18px gutter + 78px weight input + `×` + two 30px steppers + reps input +
clear + skip), so an inline 74px label overflows a phone. The member name
therefore sits on **its own line above** its `SetRow`. This is also strictly more
faithful to the spec's "`SetRow` is reused verbatim".

- [ ] **Step 1: Write the failing test**

`test/superset-render.test.js`:

```javascript
/* Server-renders SupersetCard against a seeded blob. */
const fs = require("fs");
const cp = require("child_process");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const REPO = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (n, c, note = "") => { c ? pass++ : fail++; console.log(`${c ? "  ok  " : "FAIL  "} ${n} ${note}`); };

function loadWithRealReact(file, names) {
  const html = fs.readFileSync(path.join(REPO, file), "utf8");
  let body = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1]
    .replace(/ReactDOM\.createRoot\([\s\S]*?\);\s*$/, "");
  body += `\nmodule.exports = { ${names.join(", ")} };\n`;
  const jsx = path.join(__dirname, file + ".ss.jsx");
  const out = path.join(__dirname, file + ".ss.js");
  fs.writeFileSync(jsx, body);
  cp.execFileSync("npx", ["--yes", "esbuild", jsx, "--loader:.jsx=jsx",
    "--format=cjs", "--platform=node", "--outfile=" + out], { stdio: "pipe" });
  const store = {};
  global.React = React;
  global.ReactDOM = { createRoot: () => ({ render: () => {} }) };
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: () => {} };
  global.document = { getElementById: () => null, documentElement: { style: { setProperty() {} } },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }),
    head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} } };
  global.window = global;
  global.fetch = () => Promise.resolve({ ok: false, json: () => ({}) });
  global.navigator = { userAgent: "node" };
  global.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  return require(out);
}

const mkBlob = () => ({
  version: 1, unit: "kg", userName: "Test", nameAsked: true, theme: "iron",
  rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
  deloadWeeks: [], deloadPlan: {}, cycleHistory: [],
  cycleNumber: 1, cycleName: "Cycle 1", cycleWeeks: 8, cycleStart: "2026-09-07",
  exercises: [
    { id: "press", day: "Tuesday", name: "Leg Press", prev: 80, targetSets: 3, repGoal: 10,
      supersetId: "s1", variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" },
    { id: "curl", day: "Tuesday", name: "Leg Curl", prev: 40, targetSets: 3, repGoal: 12,
      supersetId: "s1", variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" },
  ],
  sessions: {
    "2026-09-15|Tuesday": { date: "2026-09-15", day: "Tuesday", celebrated: true, entries: {
      press: { variantId: "main", note: "", swapName: "", sets: [
        { w: 90, r: 12, extra: false, tag: "" }, { w: 90, r: 11, extra: false, tag: "" }, { w: 90, r: 10, extra: false, tag: "" }] },
      curl: { variantId: "main", note: "", swapName: "", sets: [
        { w: 45, r: 12, extra: false, tag: "" }, { w: 45, r: 12, extra: false, tag: "" }, { w: 45, r: 10, extra: false, tag: "" }] },
    } },
    /* today, partially logged: round 1 done for both, round 2 empty */
    "2026-09-22|Tuesday": { date: "2026-09-22", day: "Tuesday", entries: {
      press: { variantId: "main", note: "", swapName: "", sets: [
        { w: 95, r: 12, extra: false, tag: "" }, { w: 95, r: "", extra: false, tag: "" }, { w: 95, r: "", extra: false, tag: "" }] },
      curl: { variantId: "main", note: "", swapName: "", sets: [
        { w: 50, r: 12, extra: false, tag: "" }, { w: 50, r: "", extra: false, tag: "" }, { w: 50, r: "", extra: false, tag: "" }] },
    } },
  },
});

for (const file of ["index.html", "j.html"]) {
  console.log(`\n== ${file} ==`);
  const M = loadWithRealReact(file, ["SupersetCard", "groupedExercises", "applyTheme", "applySchedule", "T"]);
  const data = mkBlob();
  M.applySchedule(undefined);
  M.applyTheme("iron");
  const group = M.groupedExercises(data.exercises.filter((e) => e.day === "Tuesday"))[0];
  ok("fixture yields one superset group", group && group.kind === "superset" && group.rounds === 3,
     `-> ${group && group.kind} rounds ${group && group.rounds}`);

  let m;
  try {
    m = renderToStaticMarkup(React.createElement(M.SupersetCard, {
      data, update: () => {}, group, sessionKey: "2026-09-22|Tuesday",
      dayColor: "#69B56D", isDeload: false,
    }));
    ok("SupersetCard renders", true, `(${m.length} chars)`);
  } catch (e) {
    ok("SupersetCard renders", false, "-> " + e.message);
    console.log(e.stack);
    continue;
  }

  ok("names both members in the title", /Leg Press/.test(m) && /Leg Curl/.test(m));
  ok("shows the superset tag", /SUPERSET/i.test(m));
  ok("shows the round count", /3\s*ROUNDS/i.test(m));
  /* Golden Rule 4: amber means tie/no-comparison, so it must not be doing
     structural work. The tag is T.muted and the group border is T.line.
     (The card renders "Superset" in markup — the caps are CSS only.) */
  ok("superset tag uses the muted colour, not amber",
     new RegExp(`color:\\s*${M.T.muted}[^"]*"[^>]*>[^<]*Superset`, "i").test(m) ||
     /Superset/.test(m) && !new RegExp(M.T.amber, "i").test(m.slice(0, m.indexOf("Superset"))),
     `-> tag region`);
  ok("collapsed card introduces no amber chrome", !new RegExp(M.T.amber, "i").test(m),
     `-> amber present: ${new RegExp(M.T.amber, "i").test(m)}`);

  /* collapsed by default, like ExerciseCard */
  ok("collapsed card has no set inputs", !/aria-label="reps"/.test(m));

  const open = renderToStaticMarkup(React.createElement(M.SupersetCard, {
    data, update: () => {}, group, sessionKey: "2026-09-22|Tuesday",
    dayColor: "#69B56D", isDeload: false, initialOpen: true,
  }));
  ok("open card renders one round block per round", (open.match(/Round \d/g) || []).length === 3,
     `-> ${JSON.stringify(open.match(/Round \d/g))}`);
  ok("open card renders a set row per member per round",
     (open.match(/aria-label="reps"/g) || []).length === 6,
     `-> ${(open.match(/aria-label="reps"/g) || []).length}`);
  ok("marks the first incomplete round as now", /Round 2[^<]*now/i.test(open) || /now/i.test(open.split("Round 2")[1] || ""));
  ok("round 1 marked complete", /Round 1[\s\S]{0,40}✓/.test(open));
  ok("member names label their rows", (open.match(/Leg Curl/g) || []).length >= 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/superset-render.test.js`
Expected: FAIL — `ReferenceError: SupersetCard is not defined`.

- [ ] **Step 3: Write `SupersetCard`**

In **both** files, insert after `ExerciseCard`'s closing brace:

```javascript
/* ------------------------------------------------------------------ */
/* Superset card (Today view) — round-interleaved                      */
/* ------------------------------------------------------------------ */
/* One card for a whole group. Each round block holds one SetRow per
   member at that round's index, in the order you actually perform them.
   Every member keeps its own session entry, so comparisons stay per
   exercise per machine — nothing here merges volume.
   `initialOpen` exists so tests can render the open state. */
function SupersetCard({ data, update, group, sessionKey, dayColor, isDeload, initialOpen }) {
  const [open, setOpen] = useState(!!initialOpen);
  const [detail, setDetail] = useState(null); /* member id whose extras are shown */
  const members = group.members;
  const rounds = group.rounds;
  /* One entry controller per member, in render order. */
  const ctl = members.map((m) => useExerciseEntry(data, update, m, sessionKey, isDeload));

  /* Baked-in sets: opening the card lays out (and heals) every member's
     planned set count, mirroring ExerciseCard. */
  useEffect(() => {
    if (!open) return;
    update((d) => {
      members.forEach((m, i) => {
        const e = ctl[i].ensureEntry(d);
        const nonExtra = e.sets.filter((s) => !s.extra);
        const extras = e.sets.filter((s) => s.extra);
        while (nonExtra.length < rounds) nonExtra.push({ w: "", r: "", extra: false, tag: "" });
        e.sets = [...nonExtra, ...extras];
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rounds]);

  const roundDone = (r) => members.every((m, i) => {
    const s = ctl[i].plannedToday[r];
    return s && (num(s.r) > 0 || s.skipped);
  });
  const nowRound = (() => {
    for (let r = 0; r < rounds; r++) if (!roundDone(r)) return r;
    return -1;
  })();
  const allDone = members.every((_, i) => ctl[i].exComplete);
  const anyBeating = members.some((_, i) => ctl[i].beating);
  const anyDown = members.some((_, i) => ctl[i].liveDelta !== null && ctl[i].liveDelta < 0);
  const groupStrip = !allDone ? T.line : anyBeating && !anyDown ? T.pos : anyDown ? T.neg : T.amber;

  return (
    <div className="ll-card" style={{ position: "relative", border: `1px solid ${T.line}` }}>
      {/* header */}
      <div onClick={() => setOpen(!open)} style={{ padding: "13px 14px", cursor: "pointer" }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Row style={{ gap: 9, minWidth: 0 }}>
            <span style={{ width: 4, alignSelf: "stretch", minHeight: 20, borderRadius: 2, background: groupStrip, flex: "none", transition: "background-color 0.5s ease" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: T.muted, marginBottom: 2 }}>
                🔗 Superset · {rounds} rounds
              </div>
              <div className="ll-display" style={{ fontSize: 18, fontWeight: 600 }}>
                {members.map((m) => m.name).join(" + ")}
              </div>
            </div>
          </Row>
          <Row style={{ gap: 8, flex: "none" }}>
            <span className="ll-num" style={{ color: T.faint, fontSize: 12 }}>
              {members.reduce((a, _, i) => a + ctl[i].exFilled, 0)}/{members.reduce((a, _, i) => a + ctl[i].exTotal, 0)}
            </span>
            <span style={{ color: T.faint, fontSize: 13 }}>{open ? "▾" : "▸"}</span>
          </Row>
        </Row>
        {/* per-member summary stays visible collapsed — a superset is still
            two exercises with their own histories */}
        <div style={{ marginTop: 7, marginLeft: 13 }}>
          {members.map((m, i) => (
            <Row key={m.id} style={{ justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ color: T.muted, fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.icon ? m.icon + " " : ""}{m.name}
                {ctl[i].lastSame ? <span style={{ color: T.faint }}> · last {setsLine(ctl[i].lastSame.entry.sets)}</span> : null}
              </span>
              <Row style={{ gap: 7, flex: "none" }}>
                <span className="ll-num" style={{ color: T.faint, fontSize: 11.5 }}>{ctl[i].exFilled}/{ctl[i].exTotal}</span>
                {!data.hideDeltas && ctl[i].exComplete && ctl[i].liveDelta !== null && <Delta value={ctl[i].liveDelta} />}
              </Row>
            </Row>
          ))}
        </div>
      </div>

      {open && (
        <div className="ll-fade" style={{ padding: "0 14px 14px", borderTop: `1px solid ${T.line}` }}>
          <Row style={{ justifyContent: "center", gap: 6, margin: "10px 0 8px", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.faint }}>
            <span>weight ({data.unit || "kg"})</span><span>×</span><span style={{ color: T.amber }}>reps</span>
          </Row>

          {/* rounds */}
          {Array.from({ length: rounds }, (_, r) => (
            <div key={r} style={{ borderTop: r === 0 ? "none" : `1px dashed ${T.line}`, paddingTop: r === 0 ? 0 : 9, marginBottom: 6 }}>
              <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, color: r === nowRound ? T.blue : T.faint, fontWeight: r === nowRound ? 700 : 400 }}>
                Round {r + 1}{roundDone(r) ? " ✓" : r === nowRound ? " — now" : ""}
              </div>
              {members.map((m, i) => {
                const s = ctl[i].todaySets.filter((x) => !x.extra)[r];
                if (!s) return null;
                const absIdx = ctl[i].todaySets.indexOf(s);
                return (
                  <div key={m.id} style={{ borderLeft: `2px solid ${T.line}`, paddingLeft: 9, marginBottom: 4 }}>
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 2 }}>
                      {m.icon ? m.icon + " " : ""}{ctl[i].entry && ctl[i].entry.swapName ? ctl[i].entry.swapName : m.name}
                    </div>
                    <SetRow idx={r} set={s} unit={data.unit} repGoal={m.repGoal}
                      compareSet={isDeload ? undefined : ctl[i].lastLogged[r]}
                      onChange={(ns) => ctl[i].changeSet(absIdx, ns)}
                      onRemove={() => ctl[i].removeSetAt(absIdx)} />
                  </div>
                );
              })}
            </div>
          ))}

          {/* extras sit outside the planned rounds, so they render as solo tails */}
          {members.map((m, i) => ctl[i].todaySets.map((s, absIdx) => (s.extra ? (
            <div key={`${m.id}-x-${absIdx}`} style={{ borderTop: `1px dashed ${T.line}`, paddingTop: 9, marginBottom: 6 }}>
              <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.07em", color: T.amber, marginBottom: 6 }}>
                Extra · {m.name} only
              </div>
              <div style={{ borderLeft: `2px solid ${T.line}`, paddingLeft: 9 }}>
                <SetRow idx={absIdx} set={s} unit={data.unit} repGoal={m.repGoal} compareSet={undefined}
                  onChange={(ns) => ctl[i].changeSet(absIdx, ns)}
                  onRemove={() => ctl[i].removeSetAt(absIdx)} />
              </div>
            </div>
          ) : null)))}

          {/* per-member extras behind a disclosure each */}
          <Row style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {members.map((m) => (
              <button key={m.id} className="ll-btn ll-btn-sm"
                onClick={() => setDetail(detail === m.id ? null : m.id)}
                aria-expanded={detail === m.id}>
                {m.name} ⋯
              </button>
            ))}
          </Row>

          {members.map((m, i) => (detail === m.id ? (
            <div key={`d-${m.id}`} className="ll-fade" style={{ background: T.bg, border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px", marginTop: 9 }}>
              <div style={{ color: T.muted, fontSize: 12.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>
                {m.name}
              </div>
              {ctl[i].lastSame ? (
                <div className="ll-num" style={{ fontSize: 14.5, marginBottom: 8 }}>
                  Last {fmtDate(ctl[i].lastSame.date)}: {setsLine(ctl[i].lastSame.entry.sets)}
                </div>
              ) : (
                <div style={{ color: T.faint, fontSize: 12.5, marginBottom: 8 }}>
                  No history on {ctl[i].variant.name}.
                </div>
              )}
              {/* machine picker */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9 }}>
                {m.variants.map((v, vi) => (
                  <button key={v.id} className={`ll-chip ${v.id === ctl[i].variantId ? "on" : ""}`}
                    onClick={() => update((d) => {
                      const dex = ctl[i].exHome(d).find((x) => x.id === m.id);
                      dex.activeVariant = v.id;
                      const s = d.sessions[sessionKey];
                      if (s && s.entries[m.id]) s.entries[m.id].variantId = v.id;
                    })}>
                    <VariantDot index={vi} /> {v.name}
                  </button>
                ))}
              </div>
              <Row style={{ gap: 6, flexWrap: "wrap" }}>
                <button className="ll-btn ll-btn-sm" onClick={ctl[i].addExtraSet}>+ Extra set</button>
                <button className="ll-btn ll-btn-sm" style={{ color: T.muted }}
                  onClick={() => ctl[i].setSkipAll(!ctl[i].skippedAll)}>
                  {ctl[i].skippedAll ? "Undo skip" : "Skip all sets"}
                </button>
              </Row>
              <input className="ll-input" style={{ marginTop: 9, fontSize: 13 }}
                placeholder={`Note for ${m.name}…`} value={(ctl[i].entry && ctl[i].entry.note) || ""}
                onChange={(e) => update((d) => { ctl[i].ensureEntry(d).note = e.target.value; })} />
            </div>
          ) : null))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the `TodayView` dispatch**

In **both** files, replace this line in `TodayView`:

```jsx
      {exList.map((ex) => (
        <ExerciseCard key={ex.id} data={data} update={update} ex={ex} sessionKey={sessionKey} dayColor={DAY_COLOR[day]} isDeload={isDeload} />
      ))}
```

with:

```jsx
      {groupedExercises(exList).map((g) => (g.kind === "superset" ? (
        <SupersetCard key={g.id} data={data} update={update} group={g} sessionKey={sessionKey} dayColor={DAY_COLOR[day]} isDeload={isDeload} />
      ) : (
        <ExerciseCard key={g.ex.id} data={data} update={update} ex={g.ex} sessionKey={sessionKey} dayColor={DAY_COLOR[day]} isDeload={isDeload} />
      )))}
```

`TodayView`'s `totalSets` / `filledSets` / `complete` math is computed from
`exList` directly and needs no change — rounds are `targetSets`, so the totals
are already correct.

- [ ] **Step 5: Run the render test to verify it passes**

Run: `node test/superset-render.test.js`
Expected: PASS — all assertions green for both files.

- [ ] **Step 6: Re-run the logging regression**

```bash
node test/logging-regression.test.js j.html
node test/logging-regression.test.js index.html
```

Expected: PASS — the dispatch change must not affect single exercises.

- [ ] **Step 7: Verify both files still compile**

Run the two esbuild commands from Global Constraints. Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add test/superset-render.test.js index.html j.html
git commit -m "Add SupersetCard and dispatch grouped exercises in TodayView

One card per group; each round block holds one SetRow per member at that
round's index, so sets are logged in the order they are performed. Every
member keeps its own entry and its own comparison, and the per-member
delta and set count stay visible on the collapsed card. Chrome is
neutral (T.line / T.muted) — amber stays semantic.

The member name sits above its SetRow rather than inline: SetRow is
already ~300px wide, so an inline label overflowed a phone."
```

---

### Task 5: Manage — chain in the gap and the group block

**Files:**
- Modify: `index.html` (the day exercise list inside `ManageView`, the `.map((ex, i, arr) => ...)` block that renders each `<Row key={ex.id}>`), `j.html` (same)
- Test: `test/superset-ui.test.js`

**Interfaces:**
- Consumes: `linkSuperset`, `unlinkSuperset`, `setSupersetRounds`, `moveExerciseGroup`, `groupedExercises` (Tasks 1–2); the existing `ManageView` locals `listFor(day)` (read side), `mutListFor(d, day)` (write side), `findEx`, `removeEx`, `editing`, `setEditing`, `editText`, `setEditText`.
- Produces: no new exported names.

- [ ] **Step 1: Write the failing test**

`test/superset-ui.test.js`:

```javascript
/* Real-Chrome: link a pair in Manage, log a round in Log, unlink.
   Prereqs: `python3 -m http.server 8777` in the repo root. */
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FILE = process.argv[2] || "j.html";
const KEY = FILE === "j.html" ? "franco-fit-j-v1" : "franco-fit-a-v2";

let pass = 0, fail = 0;
const ok = (n, c, note = "") => { c ? pass++ : fail++; console.log(`${c ? "  ok  " : "FAIL  "} ${n} ${note}`); };

const blob = {
  version: 1, unit: "kg", userName: "Test", nameAsked: true, theme: "iron",
  rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
  deloadWeeks: [], deloadPlan: {}, cycleHistory: [],
  cycleNumber: 1, cycleName: "Cycle 1", cycleWeeks: 8, cycleStart: "2026-09-07",
  exercises: [
    { id: "press", day: "Tuesday", name: "Leg Press", prev: 80, targetSets: 4, repGoal: 10,
      variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" },
    { id: "curl", day: "Tuesday", name: "Leg Curl", prev: 40, targetSets: 3, repGoal: 12,
      variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" },
  ],
  sessions: {},
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 1100, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`http://localhost:8777/${FILE}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((k, v) => { localStorage.clear(); localStorage.setItem(k, v); }, KEY, JSON.stringify(blob));
  await page.goto(`http://localhost:8777/${FILE}`, { waitUntil: "networkidle2" });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1500);

  const txt = () => page.evaluate(() => document.body.innerText);
  const clickText = (t) => page.evaluate((t) => {
    const els = [...document.querySelectorAll("button,[role=button]")];
    const el = els.find((b) => (b.textContent || "").trim() === t) ||
               els.find((b) => (b.textContent || "").includes(t));
    if (!el) return false; el.click(); return true;
  }, t);
  const clickSel = (sel, idx = 0) => page.evaluate((sel, idx) => {
    const el = document.querySelectorAll(sel)[idx];
    if (!el) return false; el.click(); return true;
  }, sel, idx);
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);

  console.log(`\n== ${FILE} · superset link / log / unlink ==`);

  /* ---- Manage: link ---- */
  ok("Manage opens", await clickText("Manage")); await wait(600);
  ok("link pill present between the two exercises",
     await page.evaluate(() => !!document.querySelector('button[aria-label^="Link"]')));
  ok("clicked the link pill", await clickSel('button[aria-label^="Link"]')); await wait(700);

  let d = await stored();
  const ids = d.exercises.map((e) => e.supersetId);
  ok("both exercises share a supersetId", !!ids[0] && ids[0] === ids[1], `-> ${JSON.stringify(ids)}`);
  ok("rounds reconciled upward to 4", d.exercises.map((e) => e.targetSets).join() === "4,4",
     `-> ${d.exercises.map((e) => e.targetSets).join()}`);
  ok("inline notice names what was raised", /raised/i.test(await txt()));
  ok("group block shows the superset tag", /SUPERSET/i.test(await txt()));
  ok("group shows one rounds control", /4 rounds/i.test(await txt()));

  /* ---- Manage: rounds stepper writes both members ---- */
  ok("rounds stepper present", await page.evaluate(() => !!document.querySelector('button[aria-label="Add a round"]')));
  await clickSel('button[aria-label="Add a round"]'); await wait(600);
  d = await stored();
  ok("rounds stepper wrote every member", d.exercises.map((e) => e.targetSets).join() === "5,5",
     `-> ${d.exercises.map((e) => e.targetSets).join()}`);
  await clickSel('button[aria-label="Remove a round"]'); await wait(600);
  d = await stored();
  ok("rounds stepper decrements every member", d.exercises.map((e) => e.targetSets).join() === "4,4");

  /* ---- Log: the group renders as one card ---- */
  ok("Log opens", await clickText("Log")); await wait(700);
  const t = await txt();
  ok("one superset card in the Log", /SUPERSET/i.test(t));
  ok("card titles both moves", /Leg Press \+ Leg Curl/.test(t), `-> ${(t.match(/Leg Press[^\n]*/) || [])[0]}`);

  ok("superset card opens", await clickText("Leg Press + Leg Curl")); await wait(700);
  ok("renders 4 round blocks", (await txt()).match(/Round \d/g).length === 4,
     `-> ${JSON.stringify((await txt()).match(/Round \d/g))}`);
  ok("renders a set row per member per round",
     await page.evaluate(() => document.querySelectorAll('input[aria-label="reps"]').length === 8),
     `-> ${await page.evaluate(() => document.querySelectorAll('input[aria-label="reps"]').length)}`);

  /* ---- Log a full round; entries must stay separate ---- */
  const fill = (idx, w, r) => page.evaluate((idx, w, r) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const ws = document.querySelectorAll('input[aria-label="weight"]');
    const rs = document.querySelectorAll('input[aria-label="reps"]');
    setter.call(ws[idx], w); ws[idx].dispatchEvent(new Event("input", { bubbles: true }));
    setter.call(rs[idx], r); rs[idx].dispatchEvent(new Event("input", { bubbles: true }));
  }, idx, w, r);

  await fill(0, "100", "10"); await wait(500);
  await fill(1, "50", "12"); await wait(700);

  d = await stored();
  const key = Object.keys(d.sessions)[0];
  const e = d.sessions[key].entries;
  ok("both members got their own entry", !!e.press && !!e.curl, `-> ${Object.keys(e).join()}`);
  ok("press round 1 landed on press", String(e.press.sets[0].w) === "100" && String(e.press.sets[0].r) === "10",
     `-> ${JSON.stringify(e.press.sets[0])}`);
  ok("curl round 1 landed on curl", String(e.curl.sets[0].w) === "50" && String(e.curl.sets[0].r) === "12",
     `-> ${JSON.stringify(e.curl.sets[0])}`);
  ok("no volume merged between members", e.press.sets.length === 4 && e.curl.sets.length === 4,
     `-> ${e.press.sets.length}/${e.curl.sets.length}`);
  ok("round 1 marks complete", /Round 1[\s\S]{0,40}✓/.test(await txt()));

  /* ---- Manage: unlink ---- */
  ok("Manage reopens", await clickText("Manage")); await wait(700);
  ok("unlink control present", await clickText("unlink")); await wait(700);
  d = await stored();
  ok("supersetId cleared from both", d.exercises.every((x) => !x.supersetId));
  ok("planned sets survive the unlink", d.exercises.map((x) => x.targetSets).join() === "4,4");

  ok("Log shows two separate cards again", await clickText("Log")); await wait(700);
  const t2 = await txt();
  ok("superset tag gone", !/SUPERSET/i.test(t2));
  ok("logged sets survive the unlink", /100/.test(t2) || /Leg Press/.test(t2));

  ok("no page errors across the run", errors.length === 0, errors[0] ? `-> ${errors[0].slice(0, 120)}` : "");

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/superset-ui.test.js j.html`
Expected: FAIL at "link pill present between the two exercises" — no
`button[aria-label^="Link"]` exists yet.

- [ ] **Step 3: Restructure the Manage day list to render groups**

In **both** files, inside `ManageView`, the day's exercise list currently maps
each exercise to a `<Row key={ex.id}>`. Replace that `.map(...)` with a grouped
render. Add these two helpers just above the `return` of the component that owns
`mutListFor` (alongside the existing `findEx` / `removeEx` definitions):

```javascript
  const [linkNote, setLinkNote] = useState("");
  const doLink = (day, idA, idB) =>
    update((d) => {
      const res = linkSuperset(mutListFor(d, day), idA, idB);
      setLinkNote(res.raised.length
        ? res.raised.map((r) => `${r.name} raised ${r.from} → ${r.to} rounds to match.`).join(" ")
        : "");
    });
```

Then render the day's list as:

```jsx
          {groupedExercises(listFor(day)).map((g, gi, garr) => {
            const prevGroup = garr[gi - 1];
            /* link pill sits in the gap ABOVE this group, joining it to the
               group above — so there is one pill per adjacent pair */
            const linkA = prevGroup && (prevGroup.kind === "single" ? prevGroup.ex : prevGroup.members[prevGroup.members.length - 1]);
            const linkB = g.kind === "single" ? g.ex : g.members[0];
            const canLink = !!linkA && !(linkA.supersetId && linkA.supersetId === linkB.supersetId);
            return (
              <div key={g.kind === "superset" ? g.id : g.ex.id}>
                {canLink && (
                  <Row style={{ justifyContent: "center", margin: "-6px 0", position: "relative", zIndex: 2 }}>
                    <button
                      aria-label={`Link ${linkA.name} with ${linkB.name} as a superset`}
                      onClick={() => doLink(day, linkA.id, linkB.id)}
                      style={{
                        background: T.surface, border: `1px dashed ${T.line}`, color: T.faint,
                        borderRadius: 999, fontSize: 10, padding: "2px 10px", letterSpacing: "0.06em",
                        cursor: "pointer", fontFamily: "inherit",
                      }}>
                      🔗 link
                    </button>
                  </Row>
                )}
                {g.kind === "superset" ? (
                  <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "7px 9px", margin: "8px 0", background: T.surface2 }}>
                    <Row style={{ justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: T.muted }}>
                        🔗 Superset
                      </span>
                      <Row style={{ gap: 4 }}>
                        <button className="ll-btn ll-btn-sm" aria-label="Remove a round"
                          onClick={() => update((d) => { setSupersetRounds(mutListFor(d, day), g.id, g.rounds - 1); })}>−</button>
                        <span className="ll-num" style={{ fontSize: 13, fontWeight: 700 }}>{g.rounds} rounds</span>
                        <button className="ll-btn ll-btn-sm" aria-label="Add a round"
                          onClick={() => update((d) => { setSupersetRounds(mutListFor(d, day), g.id, g.rounds + 1); })}>+</button>
                        <button className="ll-btn ll-btn-sm" aria-label="Move superset up"
                          onClick={() => update((d) => { moveExerciseGroup(mutListFor(d, day), day, g.id, -1); })}>↑</button>
                        <button className="ll-btn ll-btn-sm" aria-label="Move superset down"
                          onClick={() => update((d) => { moveExerciseGroup(mutListFor(d, day), day, g.id, 1); })}>↓</button>
                        <button className="ll-btn ll-btn-sm" style={{ color: T.neg }}
                          onClick={() => { update((d) => { unlinkSuperset(mutListFor(d, day), g.id); }); setLinkNote(""); }}>unlink</button>
                      </Row>
                    </Row>
                    {g.members.map((m) => (
                      <Row key={m.id} style={{ justifyContent: "space-between", padding: "5px 0" }}>
                        <span style={{ fontSize: 14.5 }}>{m.icon ? m.icon + " " : ""}{m.name}</span>
                        <Row style={{ gap: 4 }}>
                          <button className="ll-btn ll-btn-sm" onClick={() => { setEditing(m.id); setEditText(m.name); }}>✎</button>
                          <button className="ll-btn ll-btn-sm" style={{ color: T.neg }}
                            onClick={() => update((d) => { removeEx(d, day, m.id); })}>✕</button>
                        </Row>
                      </Row>
                    ))}
                  </div>
                ) : (
                  /* unchanged single-exercise row — see the note below: this is
                     a plain function call, NOT a nested component */
                  singleExerciseRow(g.ex, day, gi, garr)
                )}
              </div>
            );
          })}
          {linkNote && <div style={{ color: T.muted, fontSize: 12, marginTop: 6 }}>{linkNote}</div>}
```

**Implementation notes for this step.**

The read accessor is the existing `listFor(day)` local in `ManageView` — it
already handles the deload-vs-normal split. Do not introduce a new one.

The existing single-exercise row markup (the `<Row key={ex.id}>` block with the
icon/name inputs, the planned-sets stepper and `↑ ↓ ✎ ✕`) must be preserved
exactly. Move it verbatim into a **plain function** declared inside
`ManageView`:

```javascript
  /* Deliberately a function that returns JSX, NOT a nested component. A
     component declared during render gets a fresh identity every render, so
     React would unmount and remount this subtree on each keystroke and the
     name field's autoFocus would steal the caret mid-edit. A direct call has
     no component boundary and no remount. */
  const singleExerciseRow = (ex, day, gi, garr) => (
    /* ...the existing <Row key={ex.id}> block, unchanged except for the two
       edits listed below... */
  );
```

It closes over `editing`, `setEditing`, `editText`, `setEditText`, `update`,
`mutListFor`, `findEx` and `removeEx`. Do not retype the markup — cut and paste
it, and call it as `singleExerciseRow(g.ex, day, gi, garr)`.

Two changes inside that lifted markup, and nothing else:

1. Its `↑ ↓` handlers currently swap adjacent elements of
   `mutListFor(d, day)` by looking up `arr[i - 1].id` / `arr[i + 1].id`.
   Replace both with the group-aware move, which is also what stops a loose
   exercise landing inside a superset:

   ```jsx
                     <button className="ll-btn ll-btn-sm" disabled={gi === 0} style={{ opacity: gi === 0 ? 0.35 : 1 }}
                       onClick={() => update((d) => { moveExerciseGroup(mutListFor(d, day), day, ex.id, -1); })}>↑</button>
                     <button className="ll-btn ll-btn-sm" disabled={gi === garr.length - 1} style={{ opacity: gi === garr.length - 1 ? 0.35 : 1 }}
                       onClick={() => update((d) => { moveExerciseGroup(mutListFor(d, day), day, ex.id, 1); })}>↓</button>
   ```

   `gi` and `garr` come in as the third and fourth arguments of
   `singleExerciseRow`, supplied by the grouped map — note these are now
   **group** indices, so the disabled/opacity states correctly describe whether
   a whole group can move, not an array element.

2. Nothing else in the row changes. The planned-sets stepper stays as-is; a
   grouped exercise never renders through this function, so its stepper can
   never fight the group's rounds stepper.

- [ ] **Step 4: Run the UI test to verify it passes**

```bash
node test/superset-ui.test.js j.html
node test/superset-ui.test.js index.html
```

Expected: PASS on both.

- [ ] **Step 5: Re-run every other test**

```bash
node test/superset-logic.test.js
node test/superset-render.test.js
node test/logging-regression.test.js j.html
node test/logging-regression.test.js index.html
```

Expected: all PASS.

- [ ] **Step 6: Verify both files still compile**

Run the two esbuild commands from Global Constraints. Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add test/superset-ui.test.js index.html j.html
git commit -m "Add chain-in-the-gap superset linking to Manage

A faint link pill sits in each gap between adjacent groups; tapping it
joins them, reconciling rounds upward and saying inline what it raised.
A group renders as a block with one rounds stepper writing every member,
group-level reorder arrows and unlink. Single-exercise rows keep their
existing markup, lifted into a local component, and their reorder arrows
now swap whole groups so a loose exercise cannot land inside a superset."
```

---

### Task 6: Parity, full-suite verification and deploy handoff

**Files:**
- Modify: none (verification only), unless parity fails

- [ ] **Step 1: Verify the new code is identical across both files**

```bash
python3 - <<'PY'
import re, difflib
names = ["supersetRounds", "groupedExercises", "linkSuperset", "unlinkSuperset",
         "setSupersetRounds", "moveExerciseGroup", "useExerciseEntry", "SupersetCard"]
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
print("superset code identical across both files:", same)
if not same:
    print("\n".join(list(difflib.unified_diff(
        out["index.html"].split("\n"), out["j.html"].split("\n"),
        "index", "j", lineterm=""))[:60]))
PY
```

Expected: `superset code identical across both files: True`

- [ ] **Step 2: Verify the intentional differences are untouched**

```bash
for k in STORAGE_KEY REFEED_ROTATION PARTNER_NAME MY_INBOX; do
  echo "-- $k"; grep -hn "^const $k" index.html j.html
done
git diff --stat main -- index.html j.html
```

Expected: `franco-fit-a-v2` / `franco-fit-j-v1`, `true` / `false`,
`Jerold` / `Alicia` — and both files changed by a similar line count.

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

- [ ] **Step 4: Capture a screenshot of the finished card for review**

```bash
node -e '
const puppeteer = require("./test/node_modules/puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 420, height: 1200, deviceScaleFactor: 2 });
  await p.goto("http://localhost:8777/j.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 2000));
  await p.screenshot({ path: "/tmp/superset-card.png", fullPage: true });
  await b.close();
})();'
```

Then Read `/tmp/superset-card.png` and confirm visually: the chain rail reads as
one connected unit, round labels are legible, no horizontal overflow at 420px,
and nothing amber is doing structural work.

- [ ] **Step 5: Report to the user and stop**

Do **not** push. Summarise: what shipped, the test counts, the screenshot
finding, and that Phase 2 (Progress `🔗` markers, CSV extras note) remains.
Ask whether to merge and deploy.

---

## Self-Review

**Spec coverage.** Data model → Task 1. Grouping incl. first-appearance and
orphan collapse → Task 1. Rounds-as-`targetSets` and the max safety net → Tasks
1–2. `SetRow` reuse and `compareSet` → Task 4. `useExerciseEntry` extraction and
its regression gate → Task 3. Round blocks, `— now`, `✓`, per-member delta,
extras-as-solo-tail, per-member `⋯` → Task 4. `TodayView` dispatch → Task 4.
Manage chain pill, upward reconciliation with inline notice, triset by joining,
group rounds stepper, group move, unlink → Tasks 2 and 5. Neutral colour rule →
Task 4 (asserted in the render test). Both-files parity, differences table,
compile gate → Global Constraints and Task 6.

Spec items deliberately **not** in this plan, as Phase 2: Progress `🔗` markers
and the `buildSheetRows` extras note. Deload-week linking is covered implicitly
by using `mutListFor`, which is the existing deload-aware accessor.

**Placeholders.** None outstanding. The read accessor is named concretely
(`listFor(day)`, the existing `ManageView` local). The `SingleExerciseRow`
extraction is deliberately specified as "cut and paste the existing markup"
rather than reproduced in full, because retyping ~45 lines of unchanged JSX
invites drift; the step names every closure variable it needs and gives the
complete replacement code for the only two lines that do change.

**Bug caught in review.** The first draft had `moveSupersetGroup(list, id, dir)`
grouping and reordering `list` wholesale. `mutListFor(d, day)` returns the whole
cross-day `d.exercises` array in normal mode, so that would have grouped across
days and shuffled other days' exercises. Replaced with the day-scoped
`moveExerciseGroup(list, day, key, dir)`, which rewrites only the slots the given
day already occupies, and which also serves the single-exercise arrows. Covered
by the two cross-day assertions in Task 2.

**Type consistency.** `supersetRounds(members)`, `groupedExercises(list)`,
`linkSuperset(list, idA, idB) -> {id, raised}`, `unlinkSuperset(list, id)`,
`setSupersetRounds(list, id, rounds)`, `moveExerciseGroup(list, day, key, dir)` and
`useExerciseEntry(...)`'s returned keys are used with those exact names and
shapes in Tasks 3–5. `group.rounds` / `group.members` / `group.id` / `group.kind`
match `groupedExercises`'s output in both `SupersetCard` and `ManageView`.
