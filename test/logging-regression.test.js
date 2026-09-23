/* Guards the useExerciseEntry extraction: single-exercise logging must behave
   exactly as before. Drives the real app in Chrome.
   Prereqs: `python3 -m http.server 8777` in the repo root. */
const path = require("path");
const puppeteer = require("puppeteer-core");
const FX = require("./fixture.js");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FILE = process.argv[2] || "j.html";
const KEY = FILE === "j.html" ? "franco-fit-j-v1" : "franco-fit-a-v2";

let pass = 0, fail = 0;
const ok = (n, c, note = "") => { c ? pass++ : fail++; console.log(`${c ? "  ok  " : "FAIL  "} ${n} ${note}`); };

/* A day with one two-set exercise and history to compare against, so the
   target placeholder and green/red both have something to work from.
   The day and dates come from fixture.js: the Log tab opens on today's
   weekday, so a literal weekday here only works one day in seven. */
const FD = FX.fixtureDay();
const PRIOR = FX.weeksBefore(1, FD.date);
const blob = {
  version: 1, unit: "kg", userName: "Test", nameAsked: true, theme: "iron",
  rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
  deloadWeeks: [], deloadPlan: {}, cycleHistory: [],
  cycleNumber: 1, cycleName: "Cycle 1", cycleWeeks: 8, cycleStart: FX.ago(21, FD.date),
  exercises: [{
    id: "t-press", day: FD.day, name: "Test Press", prev: 80, targetSets: 2, repGoal: 10,
    variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main",
  }],
  sessions: {
    [`${PRIOR}|${FD.day}`]: {
      date: PRIOR, day: FD.day, celebrated: true,
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
    /* Not every clickable element is a <button> — the exercise header is a
       plain onClick div. Search buttons/[role=button] plus divs/spans, and
       among the elements whose text contains t, click the most deeply nested
       one (no matching descendant) so the click lands where a real tap would
       and still bubbles up to any ancestor's onClick handler. */
    const all = [...document.querySelectorAll("button,[role=button],div,span")];
    const matches = all.filter((el) => (el.textContent || "").includes(t));
    const deepest = matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
    const el = deepest.find((el) => (el.textContent || "").trim() === t) || deepest[0];
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
  /* the panel label is rendered "Last time" but styled text-transform:
     uppercase, so innerText reports it as "LAST TIME" — match case-insensitively */
  ok("last time panel shows the prior session", /last time/i.test(await txt()));
  ok("two planned set rows laid out", (await reps()).length === 2, `-> ${(await reps()).length}`);

  /* weight cascade: typing set 1's weight fills the blank set below. Using
     100 (matching last week's weight exactly) also doubles as the input the
     "beat last week" reps target needs — that target is only computed once
     today's own weight is entered (see SetRow), so it reads the program's
     repGoal placeholder until then. */
  await setInput('input[aria-label="weight"]', 0, "100"); await wait(400);
  ok("weight cascades to the blank set below", (await weights())[1] === "100",
     `-> ${JSON.stringify(await weights())}`);

  /* the "beat last week" target: last set 1 was 100x10, so at 100kg the
     placeholder must ask for 11 */
  const afterWeight = await reps();
  ok("set 1 placeholder asks to beat last week", afterWeight[0].placeholder === "11+",
     `-> ${JSON.stringify(afterWeight[0].placeholder)}`);

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

  /* A bodyweight exercise scores as a rep count, which is unitless. Clearing
     every weight while keeping reps is the reachable way to hit that branch —
     it must not print a converted number or a kg/lb label. */
  const nW = await page.evaluate(() => document.querySelectorAll('input[aria-label="weight"]').length);
  for (let i = 0; i < nW; i++) {
    await page.evaluate((i) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const w = document.querySelectorAll('input[aria-label="weight"]')[i];
      setter.call(w, ""); w.dispatchEvent(new Event("input", { bubbles: true }));
    }, i);
    await wait(120);
  }
  await wait(600);
  const todayLine = await page.evaluate(() => {
    const m = (document.body.innerText.match(/Today:[^\n]*/) || [""])[0];
    return m.trim();
  });
  ok("bodyweight Today line reads as reps", /\breps\b/.test(todayLine), `-> "${todayLine}"`);
  ok("bodyweight Today line carries no weight unit", !/\b(kg|lb)\b/.test(todayLine), `-> "${todayLine}"`);

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
