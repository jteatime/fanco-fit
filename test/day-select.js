/* Pinning the Log tab to a chosen weekday.
 *
 * The Log tab opens on defaultDay(), which is today's weekday when the user
 * trains on it and otherwise the nearest upcoming training day. fixtureDay()
 * picks the most recent training day today-or-earlier. Those two agree on only
 * 4 weekdays in 7 — measured, both builds:
 *
 *   j.html      match Sun Tue Wed Fri   mismatch Mon Thu Sat
 *   index.html  match Sun Tue Wed Fri   mismatch Mon Thu Sat
 *
 * On a mismatch day the fixture's exercise is simply not on screen, and a
 * suite that assumed otherwise reported a cascade of failures ending in a
 * crash on a null .match(). Noisy rather than silently green, but a false
 * report either way — and the reason a suite could pass once and then cry
 * wolf for the rest of the week.
 *
 * So don't read whatever day the tab opened on: pin it. Both puppeteer suites
 * use this, which is also why it lives here rather than inline in one of them.
 */

/* Needs the live `page` and the suite's own `wait`, since settling time after
 * a chip click is a property of the suite's pacing, not of this helper. */
function daySelector(page, wait) {
  /* The chips are abbreviated — a single letter on a build that trains 5+
     days, so "T" and "S" are ambiguous. Identify the right one by the header
     it produces rather than by its label. */
  const headerDay = () => page.evaluate(() =>
    (document.body.innerText.match(/^([A-Z][a-z]+day) ·/m) || [])[1] || "");

  /* The viewed date, as the day header renders it ("Sep 2") — this is what
     lets a week-walk locate a session instead of counting steps to it. */
  const headerDate = () => page.evaluate(() =>
    (document.body.innerText.match(/^[A-Z][a-z]+day · (.+)$/m) || [])[1] || "");

  /* Clicks the i-th day chip — the buttons beside ‹/› in the week row, which
     are the only ones there without an aria-label. Returns how many there
     are, so an out-of-range i is a pure count and clicks nothing. */
  const clickDayChip = (i) => page.evaluate((i) => {
    const prev = document.querySelector('button[aria-label="previous week"]');
    if (!prev) return 0;
    const days = [...prev.parentElement.querySelectorAll("button")]
      .filter((b) => !b.getAttribute("aria-label"));
    if (i >= 0 && i < days.length) days[i].click();
    return days.length;
  }, i);

  const selectDay = async (name) => {
    if ((await headerDay()) === name) return true;
    const n = await clickDayChip(-1);
    for (let i = 0; i < n; i++) {
      await clickDayChip(i); await wait(300);
      if ((await headerDay()) === name) return true;
    }
    return false;
  };

  return { headerDay, headerDate, clickDayChip, selectDay };
}

module.exports = { daySelector };
