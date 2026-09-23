/* Server-renders SupersetCard against a seeded blob. */
const fs = require("fs");
const cp = require("child_process");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const FX = require("./fixture.js");

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
  delete require.cache[out];
  return require(out);
}

const FD = FX.fixtureDay();
const PRIOR = FX.weeksBefore(1, FD.date);

const mkBlob = () => ({
  version: 1, unit: "kg", userName: "Test", nameAsked: true, theme: "iron",
  rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
  deloadWeeks: [], deloadPlan: {}, cycleHistory: [],
  cycleNumber: 1, cycleName: "Cycle 1", cycleWeeks: 8, cycleStart: FX.ago(21, FD.date),
  exercises: [
    { id: "press", day: FD.day, name: "Leg Press", prev: 80, targetSets: 3, repGoal: 10,
      supersetId: "s1", variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" },
    { id: "curl", day: FD.day, name: "Leg Curl", prev: 40, targetSets: 3, repGoal: 12,
      supersetId: "s1", variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" },
  ],
  sessions: {
    [`${PRIOR}|${FD.day}`]: { date: PRIOR, day: FD.day, celebrated: true, entries: {
      press: { variantId: "main", note: "", swapName: "", sets: [
        { w: 90, r: 12, extra: false, tag: "" }, { w: 90, r: 11, extra: false, tag: "" }, { w: 90, r: 10, extra: false, tag: "" }] },
      curl: { variantId: "main", note: "", swapName: "", sets: [
        { w: 45, r: 12, extra: false, tag: "" }, { w: 45, r: 12, extra: false, tag: "" }, { w: 45, r: 10, extra: false, tag: "" }] },
    } },
    /* today, partially logged: round 1 done for both, round 2 empty */
    [`${FD.date}|${FD.day}`]: { date: FD.date, day: FD.day, entries: {
      press: { variantId: "main", note: "", swapName: "", sets: [
        { w: 95, r: 12, extra: false, tag: "" }, { w: 95, r: "", extra: false, tag: "" }, { w: 95, r: "", extra: false, tag: "" }] },
      curl: { variantId: "main", note: "", swapName: "", sets: [
        { w: 50, r: 12, extra: false, tag: "" }, { w: 50, r: "", extra: false, tag: "" }, { w: 50, r: "", extra: false, tag: "" }] },
    } },
  },
});

/* An extra set on one member — exercises the solo tail-row rendering that
   had zero coverage before this fix round. */
const mkExtraBlob = () => {
  const data = mkBlob();
  data.sessions[[`${FD.date}|${FD.day}`]].entries.curl.sets.push({ w: 50, r: 8, extra: true, tag: "" });
  return data;
};

/* One member skipped wholesale, the other's round 1 logged — exercises
   Finding 1: setSkipAll marks only entry.skippedAll, never individual
   sets, so SupersetCard must consult ctl[i].skippedAll directly or a
   round with a skipped member can never complete. The skipped member's
   own sets are left unlogged (r: ""), matching what setSkipAll actually
   produces, so this fixture can only pass by reading skippedAll — not
   by coincidentally reusing already-logged reps from the base fixture. */
const mkSkipBlob = () => {
  const data = mkBlob();
  const curlEntry = data.sessions[[`${FD.date}|${FD.day}`]].entries.curl;
  curlEntry.skippedAll = true;
  curlEntry.sets = curlEntry.sets.map((s) => ({ ...s, r: "" }));
  return data;
};

for (const file of ["index.html", "j.html"]) {
  console.log(`\n== ${file} ==`);
  const M = loadWithRealReact(file, ["SupersetCard", "groupedExercises", "applyTheme", "applySchedule", "T"]);
  const data = mkBlob();
  M.applySchedule(undefined);
  M.applyTheme("iron");
  const group = M.groupedExercises(data.exercises.filter((e) => e.day === FD.day))[0];
  ok("fixture yields one superset group", group && group.kind === "superset" && group.rounds === 3,
     `-> ${group && group.kind} rounds ${group && group.rounds}`);

  let m;
  try {
    m = renderToStaticMarkup(React.createElement(M.SupersetCard, {
      data, update: () => {}, group, sessionKey: `${FD.date}|${FD.day}`,
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
     (The card renders "Superset" in markup — the caps are CSS only.)
     Match the tag element's own inline style directly, rather than
     searching the whole document, so a wrongly-coloured tag actually
     fails this assertion. */
  const tagMatch = m.match(/<div style="([^"]*)">[^<]*Superset/i);
  ok("superset tag uses the muted colour, not amber",
     !!tagMatch && tagMatch[1].includes(`color:${M.T.muted}`) && !tagMatch[1].includes(`color:${M.T.amber}`),
     `-> style="${tagMatch && tagMatch[1]}"`);
  ok("collapsed card introduces no amber chrome", !new RegExp(M.T.amber, "i").test(m),
     `-> amber present: ${new RegExp(M.T.amber, "i").test(m)}`);

  /* collapsed by default, like ExerciseCard */
  ok("collapsed card has no set inputs", !/aria-label="reps"/.test(m));

  const open = renderToStaticMarkup(React.createElement(M.SupersetCard, {
    data, update: () => {}, group, sessionKey: `${FD.date}|${FD.day}`,
    dayColor: "#69B56D", isDeload: false, initialOpen: true,
  }));
  ok("open card renders one round block per round", (open.match(/Round \d/g) || []).length === 3,
     `-> ${JSON.stringify(open.match(/Round \d/g))}`);
  ok("open card renders a set row per member per round",
     (open.match(/aria-label="reps"/g) || []).length === 6,
     `-> ${(open.match(/aria-label="reps"/g) || []).length}`);
  /* Anchored to the round label's own text node (">Round 2 — now<") so a
     "— now" marker landing on the wrong round actually fails this. */
  ok("marks the first incomplete round as now", />Round 2 — now</.test(open));
  ok("round 1 marked complete", /Round 1[\s\S]{0,40}✓/.test(open));
  ok("member names label their rows", (open.match(/Leg Curl/g) || []).length >= 3);

  /* The header counts ROUNDS, not summed sets: this fixture is 3 rounds with
     round 1 logged for both members, so 1/3 — the old summed form said 2/6. */
  ok("header counts rounds, not summed sets", / 1\/3</.test(m) || />1\/3</.test(m),
     `-> ${(m.match(/>\d+\/\d+</g) || []).join(" ")}`);
  ok("header does not show the summed set count", !/>2\/6</.test(m));

  /* Round rows drop the redundant gutter index (the round label numbers them);
     the reclaimed width is what stops the skip button shearing at 375px. */
  const gutters = (open.match(/class="ll-num"[^>]*>\s*\d+\s*</g) || []).length;
  ok("round rows carry no numeric gutter index", gutters === 0, `-> ${gutters} found`);

  /* Extras — zero coverage before this fix round. */
  const extraData = mkExtraBlob();
  const extraGroup = M.groupedExercises(extraData.exercises.filter((e) => e.day === FD.day))[0];
  const extraOpen = renderToStaticMarkup(React.createElement(M.SupersetCard, {
    data: extraData, update: () => {}, group: extraGroup, sessionKey: `${FD.date}|${FD.day}`,
    dayColor: "#69B56D", isDeload: false, initialOpen: true,
  }));
  const extraTails = extraOpen.match(/Extra · [^<]+ only/g) || [];
  ok("exactly one extra tail row renders", extraTails.length === 1, `-> ${JSON.stringify(extraTails)}`);
  ok("extra tail row is labelled with that member's name", extraTails[0] === "Extra · Leg Curl only",
     `-> ${extraTails[0]}`);
  const lastRoundIdx = extraOpen.lastIndexOf("Round 3");
  const extraIdx = extraOpen.indexOf("Extra ·");
  ok("extra tail row renders after the round blocks", lastRoundIdx !== -1 && extraIdx > lastRoundIdx,
     `-> round@${lastRoundIdx} extra@${extraIdx}`);

  /* Finding 1: a wholesale-skipped member (setSkipAll marks only the entry,
     never the individual sets) must still let its round complete, must
     render as a skipped placeholder rather than a bare editable SetRow,
     and must let "now" advance past it. */
  const skipData = mkSkipBlob();
  const skipGroup = M.groupedExercises(skipData.exercises.filter((e) => e.day === FD.day))[0];
  const skipOpen = renderToStaticMarkup(React.createElement(M.SupersetCard, {
    data: skipData, update: () => {}, group: skipGroup, sessionKey: `${FD.date}|${FD.day}`,
    dayColor: "#69B56D", isDeload: false, initialOpen: true,
  }));
  ok("round 1 completes when the skipped member counts as done", />Round 1 ✓</.test(skipOpen));
  ok("skipped member renders a skipped placeholder, not a reps input", /— skipped today/.test(skipOpen));
  const skipRepsCount = (skipOpen.match(/aria-label="reps"/g) || []).length;
  const memberRoundCount = skipGroup.members.length * skipGroup.rounds;
  ok("skipped member contributes no reps inputs, so the open card has fewer than members × rounds",
     skipRepsCount === 3 && skipRepsCount < memberRoundCount, `-> ${skipRepsCount} reps inputs`);
  ok("now marker advances past the completed round", />Round 2 — now</.test(skipOpen));
}

/* ---- the "other machine" fallback in a member's detail panel ----
   A lone exercise shows "Other machine, <date>: ..." when it has no history
   on the machine it is currently set to. SupersetCard dead-ended at "No
   history on X", leaving a member's first session on a new machine with no
   reference at all. */
for (const file of ["index.html", "j.html"]) {
  const M = loadWithRealReact(file, ["SupersetCard", "groupedExercises", "applyTheme", "applySchedule", "T"]);
  const data = mkBlob();
  M.applySchedule(undefined);
  M.applyTheme("iron");
  /* press gains a second machine and is switched to it: no history there,
     but its history on the original machine should still be offered */
  const press = data.exercises.find((e) => e.id === "press");
  press.variants = [{ id: "main", name: "Usual machine" }, { id: "plate", name: "Plate loaded" }];
  press.activeVariant = "plate";
  /* the live entry's variantId wins over activeVariant, so switch it there too
     — otherwise the card still resolves history on the original machine */
  data.sessions[`${FD.date}|${FD.day}`].entries.press.variantId = "plate";
  const g = M.groupedExercises(data.exercises.filter((e) => e.day === FD.day))[0];
  const panel = renderToStaticMarkup(React.createElement(M.SupersetCard, {
    data, update: () => {}, group: g, sessionKey: `${FD.date}|${FD.day}`,
    dayColor: "#69B56D", isDeload: false, initialOpen: true, initialDetail: "press",
  }));
  console.log(`\n== ${file} · other-machine fallback ==`);
  ok("panel says there is no history on the new machine", /No history on Plate loaded/.test(panel));
  ok("and offers the other machine's last session", /Other machine,/.test(panel),
     `-> ${(panel.match(/Other machine,[^<]*/) || ["(absent)"])[0]}`);
  const region = (panel.match(/Other machine,[\s\S]{0,140}/) || [""])[0].replace(/<[^>]+>/g, " ");
  ok("naming the actual sets from that machine", /90/.test(region) && /12/.test(region),
     `-> ${region.trim().slice(0, 70)}`);
  /* the unswitched member still reports its own history normally */
  ok("the other member is unaffected", /Leg Curl/.test(panel));
}

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
