/* Real-Chrome: link a pair in Manage, log a round in Log, unlink.
   Prereqs: `python3 -m http.server 8777` in the repo root. */
const path = require("path");
const puppeteer = require("puppeteer-core");
const FX = require("./fixture.js");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FILE = process.argv[2] || "j.html";
const KEY = FILE === "j.html" ? "franco-fit-j-v1" : "franco-fit-a-v2";

let pass = 0, fail = 0;
const ok = (n, c, note = "") => { c ? pass++ : fail++; console.log(`${c ? "  ok  " : "FAIL  "} ${n} ${note}`); };

const FD = FX.fixtureDay();

const blob = {
  version: 1, unit: "kg", userName: "Test", nameAsked: true, theme: "iron",
  rewardId: "gold-star", weights: {}, bwUnit: "lb", sentNotes: [], noteAcks: {},
  deloadWeeks: [], deloadPlan: {}, cycleHistory: [],
  cycleNumber: 1, cycleName: "Cycle 1", cycleWeeks: 8, cycleStart: FX.ago(21, FD.date),
  exercises: [
    { id: "press", day: FD.day, name: "Leg Press", prev: 80, targetSets: 4, repGoal: 10,
      variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" },
    { id: "curl", day: FD.day, name: "Leg Curl", prev: 40, targetSets: 3, repGoal: 12,
      variants: [{ id: "main", name: "Usual machine" }], activeVariant: "main" },
  ],
  /* prior week, deliberately light, so today's work clearly beats it —
     without history nothing is "beating" and the burst can never fire */
  sessions: {
    [`${FX.weeksBefore(1, FD.date)}|${FD.day}`]: {
      date: FX.weeksBefore(1, FD.date), day: FD.day, celebrated: true, entries: {
        press: { variantId: "main", note: "", swapName: "", sets: [
          { w: 50, r: 5, extra: false, tag: "" }, { w: 50, r: 5, extra: false, tag: "" },
          { w: 50, r: 5, extra: false, tag: "" }, { w: 50, r: 5, extra: false, tag: "" }] },
        curl: { variantId: "main", note: "", swapName: "", sets: [
          { w: 40, r: 5, extra: false, tag: "" }, { w: 40, r: 5, extra: false, tag: "" },
          { w: 40, r: 5, extra: false, tag: "" }, { w: 40, r: 5, extra: false, tag: "" }] },
      },
    },
  },
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
    /* Not every clickable element is a <button> — the superset card header
       (like the exercise header) is a plain onClick div. Search
       buttons/[role=button] plus divs/spans, and among the elements whose
       text contains t, click the most deeply nested one (no matching
       descendant) so the click lands where a real tap would and still
       bubbles up to any ancestor's onClick handler. Mirrors
       logging-regression.test.js's clickText. */
    const all = [...document.querySelectorAll("button,[role=button],div,span")];
    const matches = all.filter((el) => (el.textContent || "").includes(t));
    const deepest = matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
    const el = deepest.find((el) => (el.textContent || "").trim() === t) || deepest[0];
    if (!el) return false; el.click(); return true;
  }, t);
  const clickSel = (sel, idx = 0) => page.evaluate((sel, idx) => {
    const el = document.querySelectorAll(sel)[idx];
    if (!el) return false; el.click(); return true;
  }, sel, idx);
  const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  /* The app debounces localStorage writes (scheduleSave, 800ms) behind
     setData. A fixed sleep race the debounce on a loaded machine — poll for
     the expected shape instead, with a generous ceiling. On timeout this
     still returns the last value read, so the assertion reports what was
     actually there rather than hanging. */
  const storedUntil = async (pred, timeout = 5000) => {
    const t0 = Date.now();
    for (;;) {
      const d = await stored();
      if (d && pred(d)) return d;
      if (Date.now() - t0 > timeout) return d;
      await wait(100);
    }
  };

  console.log(`\n== ${FILE} · superset link / log / unlink ==`);

  /* ---- Manage: link ---- */
  ok("Manage opens", await clickText("Manage")); await wait(600);
  ok("link pill present between the two exercises",
     await page.evaluate(() => !!document.querySelector('button[aria-label^="Link"]')));
  ok("clicked the link pill", await clickSel('button[aria-label^="Link"]'));

  let d = await storedUntil((d) => d.exercises[0].supersetId && d.exercises[0].supersetId === d.exercises[1].supersetId);
  const ids = d.exercises.map((e) => e.supersetId);
  ok("both exercises share a supersetId", !!ids[0] && ids[0] === ids[1], `-> ${JSON.stringify(ids)}`);
  ok("rounds reconciled upward to 4", d.exercises.map((e) => e.targetSets).join() === "4,4",
     `-> ${d.exercises.map((e) => e.targetSets).join()}`);
  ok("inline notice names what was raised", /raised/i.test(await txt()));
  const raisedCount = await page.evaluate(() => (document.body.innerText.match(/rounds to match\./g) || []).length);
  ok("raised-notice appears exactly once, not once per day card", raisedCount === 1, `-> ${raisedCount}`);
  ok("group block shows the superset tag", /SUPERSET/i.test(await txt()));
  ok("group shows one rounds control", /4 rounds/i.test(await txt()));

  /* ---- Manage: rounds stepper writes both members ---- */
  ok("rounds stepper present", await page.evaluate(() => !!document.querySelector('button[aria-label="Add a round"]')));
  await clickSel('button[aria-label="Add a round"]');
  d = await storedUntil((d) => d.exercises.every((e) => e.targetSets === 5));
  ok("rounds stepper wrote every member", d.exercises.map((e) => e.targetSets).join() === "5,5",
     `-> ${d.exercises.map((e) => e.targetSets).join()}`);
  await clickSel('button[aria-label="Remove a round"]');
  d = await storedUntil((d) => d.exercises.every((e) => e.targetSets === 4));
  ok("rounds stepper decrements every member", d.exercises.map((e) => e.targetSets).join() === "4,4");

  /* ---- Log: the group renders as one card ---- */
  ok("Log opens", await clickText("Log")); await wait(700);
  const t = await txt();
  ok("one superset card in the Log", /SUPERSET/i.test(t));
  ok("card titles both moves", /Leg Press \+ Leg Curl/.test(t), `-> ${(t.match(/Leg Press[^\n]*/) || [])[0]}`);

  ok("superset card opens", await clickText("Leg Press + Leg Curl")); await wait(700);
  ok("renders 4 round blocks", (await txt()).match(/Round \d/gi).length === 4,
     `-> ${JSON.stringify((await txt()).match(/Round \d/gi))}`);
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
  await fill(1, "50", "12");

  d = await storedUntil((d) => {
    const k = Object.keys(d.sessions).find((x) => x.startsWith(FD.date));
    const e = k && d.sessions[k].entries;
    return !!(e && e.press && e.curl && e.press.sets[0] && String(e.press.sets[0].r) === "10"
      && e.curl.sets[0] && String(e.curl.sets[0].r) === "12");
  });
  /* today's session specifically — the fixture also carries prior-week
     history, so [0] would read the wrong one */
  const key = Object.keys(d.sessions).find((k) => k.startsWith(FD.date));
  const e = d.sessions[key].entries;
  ok("both members got their own entry", !!e.press && !!e.curl, `-> ${Object.keys(e).join()}`);
  ok("press round 1 landed on press", String(e.press.sets[0].w) === "100" && String(e.press.sets[0].r) === "10",
     `-> ${JSON.stringify(e.press.sets[0])}`);
  ok("curl round 1 landed on curl", String(e.curl.sets[0].w) === "50" && String(e.curl.sets[0].r) === "12",
     `-> ${JSON.stringify(e.curl.sets[0])}`);

  /* Every set the cascade fills is a real logged weight and must carry the
     unit stamp — not just the one index the user typed into. */
  const allStamped = await page.evaluate((k, date) => {
    const d = JSON.parse(localStorage.getItem(k));
    const key = Object.keys(d.sessions).find((x) => x.startsWith(date));
    const e = d.sessions[key].entries;
    const weighted = [...e.press.sets, ...e.curl.sets].filter((s) => Number(s.w) > 0);
    return { n: weighted.length, unstamped: weighted.filter((s) => !s.u).length, unit: d.unit };
  }, KEY, FD.date);
  ok("every cascaded set carries a unit stamp", allStamped.n > 1 && allStamped.unstamped === 0,
     `-> ${allStamped.n} weighted sets, ${allStamped.unstamped} unstamped`);

  /* Clearing a weight must drop the stamp, so re-entering in another unit
     is not mislabelled. Restored immediately after — later assertions
     ("logged sets survive the unlink") depend on set 0 staying 100/10. */
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const w = document.querySelectorAll('input[aria-label="weight"]')[0];
    setter.call(w, ""); w.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(900);
  const cleared = await page.evaluate((k, date) => {
    const d = JSON.parse(localStorage.getItem(k));
    const key = Object.keys(d.sessions).find((x) => x.startsWith(date));
    return "u" in d.sessions[key].entries.press.sets[0];
  }, KEY, FD.date);
  ok("clearing a weight drops its unit stamp", cleared === false, `-> "u" present: ${cleared}`);
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const w = document.querySelectorAll('input[aria-label="weight"]')[0];
    setter.call(w, "100"); w.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await storedUntil((d) => {
    const k = Object.keys(d.sessions).find((x) => x.startsWith(FD.date));
    const en = k && d.sessions[k].entries;
    return !!(en && en.press && String(en.press.sets[0].w) === "100");
  });
  ok("no volume merged between members", e.press.sets.length === 4 && e.curl.sets.length === 4,
     `-> ${e.press.sets.length}/${e.curl.sets.length}`);
  ok("round 1 marks complete", /Round 1[\s\S]{0,40}✓/i.test(await txt()));

  /* The skip button used to shear off the right edge of the card — 27px of
     overflow on a superset at 390px, worse on narrower phones, and ordinary
     exercise cards clipped too. Assert it fits at the narrowest common iPhone
     width, with the superset card open (the widest row the app renders). */
  await page.setViewport({ width: 375, height: 950, deviceScaleFactor: 2 });
  await wait(700);
  const clip = await page.evaluate(() => {
    const inp = document.querySelector('input[aria-label="reps"]');
    if (!inp) return { err: "no set row open" };
    const card = inp.closest(".ll-card");
    const skip = [...document.querySelectorAll("button")].find((b) => /^skip$/.test((b.textContent || "").trim()));
    if (!skip) return { err: "no skip button" };
    return { overflow: Math.round(skip.getBoundingClientRect().right - card.getBoundingClientRect().right) };
  });
  ok("skip button fits inside the card at 375px", clip.overflow !== undefined && clip.overflow <= 0,
     `-> ${clip.err || clip.overflow + "px relative to the card edge"}`);
  await page.setViewport({ width: 420, height: 950, deviceScaleFactor: 2 });
  await wait(500);

  /* Finishing a superset earns the confetti a lone exercise gets. Round 1 is
     already logged above at 100/10 — fill only the LATER rounds so the
     "logged sets survive the unlink" assertion still sees 100/10 in set 0. */
  const inputCount = await page.evaluate(() => document.querySelectorAll('input[aria-label="reps"]').length);
  for (let i = 2; i < inputCount; i++) {
    await page.evaluate((i) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      const ws = document.querySelectorAll('input[aria-label="weight"]');
      const rs = document.querySelectorAll('input[aria-label="reps"]');
      if (ws[i]) { setter.call(ws[i], "200"); ws[i].dispatchEvent(new Event("input", { bubbles: true })); }
      if (rs[i]) { setter.call(rs[i], "20"); rs[i].dispatchEvent(new Event("input", { bubbles: true })); }
    }, i);
    await wait(110);
  }
  await wait(500);
  const burst = await page.evaluate(() => document.querySelectorAll(".ll-mini").length);
  ok("finishing the superset fires the confetti burst", burst > 0,
     `-> ${burst} particles across ${inputCount} inputs`);
  await wait(1100);
  ok("the burst clears itself", (await page.evaluate(() => document.querySelectorAll(".ll-mini").length)) === 0);

  /* The Progress card for a paired exercise names its partner — checked while
     still linked, since unlinking later removes the pairing. */
  ok("Progress opens while still linked", await clickText("Progress")); await wait(900);
  const marker = await page.evaluate(() => {
    const t = document.body.innerText;
    return { press: /🔗 with Leg Curl/.test(t), curl: /🔗 with Leg Press/.test(t) };
  });
  ok("Progress marks Leg Press as paired with Leg Curl", marker.press, `-> ${JSON.stringify(marker)}`);
  ok("and Leg Curl as paired with Leg Press", marker.curl);
  ok("back to Log", await clickText("Log")); await wait(700);

  /* ---- Manage: ✎ inside the group block actually edits a member ---- */
  ok("Manage reopens for the edit check", await clickText("Manage")); await wait(700);
  ok("clicked ✎ on a grouped member", await clickText("✎"));
  const editInputPresent = await page.evaluate(() =>
    [...document.querySelectorAll("input.ll-input")].some((i) => i.value === "Leg Press"));
  ok("an input carrying that member's name appears", editInputPresent);
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const el = [...document.querySelectorAll("input.ll-input")].find((i) => i.value === "Leg Press");
    setter.call(el, "Leg Press Machine");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  ok("clicked Done", await clickText("Done"));
  d = await storedUntil((d) => d.exercises.some((x) => x.id === "press" && x.name === "Leg Press Machine"));
  ok("rename persisted to storage",
     d.exercises.some((x) => x.id === "press" && x.name === "Leg Press Machine"),
     `-> ${d.exercises.map((x) => x.name).join()}`);

  /* ---- Manage: unlink ---- */
  ok("Manage reopens", await clickText("Manage")); await wait(700);
  ok("unlink control present", await clickText("unlink"));
  d = await storedUntil((d) => d.exercises.every((x) => !x.supersetId));
  ok("supersetId cleared from both", d.exercises.every((x) => !x.supersetId));
  ok("planned sets survive the unlink", d.exercises.map((x) => x.targetSets).join() === "4,4");
  const pressAfterUnlink = d.sessions[Object.keys(d.sessions).find((k) => k.startsWith(FD.date))].entries.press;
  ok("logged sets survive the unlink",
     String(pressAfterUnlink.sets[0].w) === "100" && String(pressAfterUnlink.sets[0].r) === "10",
     `-> ${JSON.stringify(pressAfterUnlink.sets[0])}`);

  ok("Log shows two separate cards again", await clickText("Log")); await wait(700);
  const t2 = await txt();
  ok("superset tag gone", !/SUPERSET/i.test(t2));


  /* The Progress tab's stat strip and charts default to ALL TIME, not the live
     cycle — a freshly started cycle would otherwise open on an empty strip.
     StatStrip marks the active scope with aria-pressed. */
  ok("Progress opens", await clickText("Progress")); await wait(800);
  const scopeState = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button[aria-pressed]")]
      .map((b) => ({ label: (b.textContent || "").trim(), pressed: b.getAttribute("aria-pressed") }))
      .filter((b) => /all time|cycle/i.test(b.label));
    return btns;
  });
  const allTime = scopeState.find((b) => /all time/i.test(b.label));
  ok("stat strip defaults to All time", !!allTime && allTime.pressed === "true",
     `-> ${JSON.stringify(scopeState)}`);
  ok("the cycle scope is not the default", scopeState.some((b) => /cycle/i.test(b.label) && b.pressed === "false"),
     `-> ${JSON.stringify(scopeState)}`);

  ok("no page errors across the run", errors.length === 0, errors[0] ? `-> ${errors[0].slice(0, 120)}` : "");

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
