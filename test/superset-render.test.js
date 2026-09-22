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
