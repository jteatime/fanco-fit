/* Pure superset grouping. Runs against the real script in both HTML files. */
const path = require("path");
const os = require("os");
const load = require("./harness.js");
const FXX = require("./fixture.js");

const REPO = path.join(__dirname, "..");
const API = ["groupedExercises", "supersetRounds", "linkSuperset", "unlinkSuperset", "setSupersetRounds", "moveExerciseGroup", "partnersOf", "buildSheetRows"];

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
