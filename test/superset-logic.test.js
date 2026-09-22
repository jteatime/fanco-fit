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
