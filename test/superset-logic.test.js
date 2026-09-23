/* Pure superset grouping. Runs against the real script in both HTML files. */
const path = require("path");
const os = require("os");
const load = require("./harness.js");
const FXX = require("./fixture.js");

const REPO = path.join(__dirname, "..");
const API = ["groupedExercises", "supersetRounds", "linkSuperset", "unlinkSuperset", "setSupersetRounds", "moveExerciseGroup", "partnersOf", "buildSheetRows", "kgOf", "toUnit", "volumeOf", "scoreOf", "migrateUnits", "SEED_UNIT", "exerciseEntry", "num"];

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(ok ? `  ok   ${name}` :
    `FAIL   ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};
const ok = (name, cond, note = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "} ${name} ${note}`);
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

/* Every set in a blob, wherever it lives. */
const allSets = (d) => Object.values(d.sessions || {})
  .flatMap((s) => Object.values(s.entries || {}))
  .flatMap((e) => e.sets || []);

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

  /* Linking two exercises that are each already in a group merges both
     groups whole — no member gets stranded behind. */
  {
    const list = [ex("a", 3, "s1"), ex("b", 3, "s1"), ex("c", 4, "s2"), ex("d", 4, "s2")];
    const res = M.linkSuperset(list, "b", "c");
    eq("merging two groups leaves exactly one group",
       shape(M.groupedExercises(list)), [["superset", res.id, 4, ["a", "b", "c", "d"]]]);
    eq("no member is stranded in the old group",
       list.every((e) => e.supersetId === res.id), true);
    eq("every member reconciles to the higher round count",
       list.map((e) => e.targetSets), [4, 4, 4, 4]);
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

  /* ---- partnersOf: what the Progress 🔗 marker reads ---- */
  {
    const list = [ex("a", 3, "s1"), ex("b", 3, "s1"), ex("c", 3)];
    eq("partnersOf names the partner both ways",
       M.partnersOf(list), { a: ["b"], b: ["a"] });
    eq("partnersOf ignores an unpaired exercise", "c" in M.partnersOf(list), false);

    const tri = [ex("a", 3, "s1"), ex("b", 3, "s1"), ex("d", 3, "s1")];
    eq("a triset member names both partners", M.partnersOf(tri).a, ["b", "d"]);

    /* the reason this goes through groupedExercises: a lone exercise still
       carrying a supersetId must NOT claim a partner */
    eq("a stale supersetId on a collapsed single names nobody",
       M.partnersOf([ex("a", 3, "s1"), ex("c", 3)]), {});
    eq("empty list", M.partnersOf([]), {});
  }

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
    /* Deliberately crossed against SEED_UNIT so the archived-vs-live
       distinction is meaningful on BOTH files' passes through this loop —
       on index.html SEED_UNIT === "lb", so a live unit hardcoded to "lb"
       would pass even if the code wrongly read d.unit for archived sets. */
    const LIVE_UNIT = M.SEED_UNIT === "kg" ? "lb" : "kg";
    const mk = () => ({
      version: 1, unit: LIVE_UNIT, userName: "T", nameAsked: true, theme: "iron",
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
       d.sessions[`${NEW}|${FD2.day}`].entries.a.sets.map((s) => s.u), [LIVE_UNIT, LIVE_UNIT]);
    eq("ex.prevU is stamped from the outgoing cycle",
       d.exercises[0].prevU, M.SEED_UNIT);

    /* no logged weight may change — that is the whole premise */
    eq("stored weights are untouched",
       [d.sessions[`${OLD}|${FD2.day}`].entries.a.sets[0].w,
        d.sessions[`${NEW}|${FD2.day}`].entries.a.sets[0].w], [70, 180]);

    /* idempotent: a second run changes nothing */
    const once = JSON.stringify(d);
    eq("migration is idempotent", JSON.stringify(M.migrateUnits(d)), once);

    /* an existing stamp is authoritative and never overwritten — model a
       partially-migrated (e.g. interrupted-load) set: one sibling already
       stamped with the "wrong" (live) unit, the other still bare. */
    const pre = mk();
    pre.sessions[`${OLD}|${FD2.day}`].entries.a.sets[0].u = LIVE_UNIT;
    const migratedPre = M.migrateUnits(pre);
    eq("a pre-existing stamp survives",
       migratedPre.sessions[`${OLD}|${FD2.day}`].entries.a.sets[0].u, LIVE_UNIT);
    eq("its unstamped sibling still gets migrated correctly",
       migratedPre.sessions[`${OLD}|${FD2.day}`].entries.a.sets[1].u, M.SEED_UNIT);

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
        sd.sessions[`${NEW}|${FD2.day}`].entries.a.sets[0].u], [LIVE_UNIT, LIVE_UNIT]);
  }

  /* ---- the invariant: no weighted set is ever left unstamped ----
     volumeOf reads a missing `u` as kg, so an unstamped weighted set is
     counted as kg whatever the user typed. Three separate places construct
     set objects — the typed weight, the weight cascade, and the extra-set
     button — and this branch shipped with the third one unstamped, because
     the completeness check was a grep for syntax rather than a statement of
     the property. So state the property: drive a real logging session
     through the shipped exerciseEntry (typed weights, cascade, extra set)
     and assert that nothing weighted anywhere in the blob lacks a stamp. A
     fourth set-writer cannot slip past this. */
  {
    const FD4 = FXX.fixtureDay();
    const blob = {
      version: 1, unit: "lb", userName: "T", nameAsked: true, theme: "iron",
      rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
      deloadWeeks: [], deloadPlan: {}, cycleHistory: [],
      cycleNumber: 1, cycleName: "Cycle 1", cycleWeeks: 8, cycleStart: FXX.ago(21, FD4.date),
      exercises: [{ id: "a", day: FD4.day, name: "Leg Press", prev: 70, targetSets: 3, repGoal: 10,
                    variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" }],
      sessions: {},
    };
    const key = `${FD4.date}|${FD4.day}`;
    /* The app's update() hands the mutator the live blob; mirror that. */
    const update = (fn) => { fn(blob); };
    const drive = () => M.exerciseEntry(blob, update, blob.exercises[0], key, false);

    drive().changeSet(0, { w: "100", r: "8", extra: false, tag: "" });   /* + cascade */
    drive().changeSet(1, { w: "105", r: "6", extra: false, tag: "" });   /* + cascade */
    drive().addExtraSet();                                              /* copies 105 */

    const weighted = allSets(blob).filter((s) => M.num(s.w) > 0);
    const unstamped = weighted.filter((s) => !s.u);
    ok("no weighted set anywhere is left unstamped",
       weighted.length === 4 && unstamped.length === 0,
       `-> ${weighted.length} weighted (want 4), ${unstamped.length} unstamped ${JSON.stringify(unstamped)}`);
  }

  /* ---- a row's own stamp survives an edit, even against its session ----
     Manage -> Units changes data.unit and explicitly does NOT convert stored
     numbers, so a row stamped lb can sit in a session whose unit is now kg.
     colUnit prefers the ROW's stamp, so that is what the column header and
     the placeholder show the user. changeSet must therefore keep it: writing
     sessionUnit instead would store kg under a column labelled lb, and leave
     one exercise holding both units at once — permanently, since stamps are
     authoritative and never re-derived. A review wave specified exactly that
     re-stamp; this assertion is what stops it coming back. Deliberate
     re-uniting goes through a clear (which drops the stamp), asserted below. */
  {
    const FD5 = FXX.fixtureDay();
    const blob = {
      version: 1, unit: "kg", userName: "T", nameAsked: true, theme: "iron",
      rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
      deloadWeeks: [], deloadPlan: {}, cycleHistory: [],
      cycleNumber: 1, cycleName: "Cycle 1", cycleWeeks: 8, cycleStart: FXX.ago(21, FD5.date),
      exercises: [{ id: "a", day: FD5.day, name: "Leg Press", prev: 70, targetSets: 3, repGoal: 10,
                    variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" }],
      sessions: {
        /* logged before the switch: three lb rows in a now-kg session */
        [`${FD5.date}|${FD5.day}`]: {
          date: FD5.date, day: FD5.day,
          entries: { a: { variantId: "main", note: "", swapName: "", sets: [
            { w: "180", r: "8", extra: false, tag: "", u: "lb" },
            { w: "180", r: "8", extra: false, tag: "", u: "lb" },
            { w: "180", r: "8", extra: false, tag: "", u: "lb" }] } },
        },
      },
    };
    const key = `${FD5.date}|${FD5.day}`;
    const update = (fn) => { fn(blob); };
    const drive = () => M.exerciseEntry(blob, update, blob.exercises[0], key, false);
    const sets = () => blob.sessions[key].entries.a.sets;

    eq("the session's unit really does disagree with the rows", drive().sessionUnit, "kg");

    /* correcting set 1: 180 -> 185, in a column the app labels lb */
    drive().changeSet(0, { ...sets()[0], w: "185" });
    eq("an edited weight keeps the row's own stamp", sets()[0].u, "lb");
    eq("and the cascade leaves its siblings' stamps alone",
       sets().map((s) => s.u).join(), "lb,lb,lb");
    /* the real damage of a re-stamp is two units inside one exercise */
    eq("one exercise never holds two units at once",
       new Set(sets().filter((s) => M.num(s.w) > 0).map((s) => s.u)).size, 1);

    /* the documented way to re-unit a row: clear it, then retype */
    drive().changeSet(0, { ...sets()[0], w: "" });
    eq("clearing a weight drops the stamp", sets()[0].u, undefined);
    drive().changeSet(0, { ...sets()[0], w: "84" });
    eq("retyping after a clear adopts the session's unit", sets()[0].u, "kg");
  }

  /* ---- CSV: the Supersets block ---- */
  {
    const mk = (id, name, sets, ss) => ({ ...ex(id, sets, ss), name, prev: 70, repGoal: 10 });
    const paired = {
      version: 1, unit: "kg", userName: "T", nameAsked: true, theme: "iron", rewardId: "gold-star",
      weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {}, deloadWeeks: [], deloadPlan: {},
      cycleHistory: [], cycleNumber: 1, cycleName: "Cycle 1", cycleWeeks: 8,
      cycleStart: FXX.ago(21), sessions: {},
      exercises: [mk("p", "Leg Press", 4, "s1"), mk("c", "Leg Curl", 4, "s1"), mk("z", "Calf Raise", 3)],
    };
    const flat = M.buildSheetRows(paired).map((r) => (r || []).join("|"));
    eq("export gains a Supersets block", flat.includes("Supersets"), true);
    eq("its header names the columns", flat.includes("Day|Exercises|Rounds"), true);
    ok("it lists the pair once with its round count",
       flat.filter((r) => /Leg Press \+ Leg Curl\|4$/.test(r)).length === 1,
       `-> ${flat.filter((r) => /Leg Press \+ Leg Curl/.test(r)).join(" ;; ")}`);
    ok("the unpaired exercise is not in the block",
       !flat.some((r) => /^\w+day\|Calf Raise/.test(r)));

    /* an export with no supersets must be byte-identical to before */
    const unpaired = JSON.parse(JSON.stringify(paired));
    unpaired.exercises.forEach((e) => { delete e.supersetId; });
    const flatU = M.buildSheetRows(unpaired).map((r) => (r || []).join("|"));
    eq("no supersets -> no Supersets block at all", flatU.includes("Supersets"), false);
  }

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
    eq("the export states its unit", flat.includes("Units"), true);
    eq("its header names the columns", flat.includes("Cycle|Unit"), true);
    ok("it names the LIVE cycle and its unit",
       flat.some((r) => /^Cycle 2\|lb$/.test(r)),
       `-> ${flat.filter((r) => /\|(kg|lb)$/.test(r)).join(" ;; ")}`);
    /* the archived cycle's numbers are not in this sheet, so it must not be
       listed as though they were */
    ok("it does NOT list the archived cycle", !flat.some((r) => /^Cycle 1\|/.test(r)),
       `-> ${flat.filter((r) => /^Cycle \d\|/.test(r)).join(" ;; ")}`);
    eq("exactly one cycle row", flat.filter((r) => /^Cycle \d\|(kg|lb)$/.test(r)).length, 1);
  }
}

/* ---- the test fixtures themselves must not depend on what day it is ----
   These suites hardcoded a weekday and so passed on one day in seven,
   reporting false failures the rest of the week. fixtureDay() must pick a
   day both app builds train on, never in the future, whatever today is. */
{
  const FX = require("./fixture.js");
  for (let i = 0; i < 7; i++) {
    const today = FX.ago(i);
    const fd = FX.fixtureDay(today);
    eq(`fixtureDay(${FX.dayOf(today)}) picks a shared training day`,
       FX.SHARED_TRAINING_DAYS.includes(fd.day), true);
    eq(`fixtureDay(${FX.dayOf(today)}) is never in the future`, fd.date <= today, true);
    eq(`fixtureDay(${FX.dayOf(today)}) name matches its date`, FX.dayOf(fd.date), fd.day);
    eq(`fixtureDay(${FX.dayOf(today)}) is within the last week`, fd.back >= 0 && fd.back < 7, true);
  }
  /* prior-week history must land on the same weekday, a week earlier */
  const fd = FX.fixtureDay();
  eq("weeksBefore keeps the weekday", FX.dayOf(FX.weeksBefore(1, fd.date)), fd.day);
  eq("weeksBefore(1) is 7 days earlier", FX.weeksBefore(1, fd.date), FX.ago(7, fd.date));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
