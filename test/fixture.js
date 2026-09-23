/* Date-proof fixture helpers.
 *
 * The Log tab opens on today's weekday, so a fixture pinned to a literal
 * "Tuesday" only works on Tuesdays — the suites here did exactly that and so
 * passed once and then reported false failures every other day of the week.
 *
 * Both app builds train on an overlapping set of days: j.html is fixed to
 * Tue/Wed/Fri/Sun, and index.html rotates around its refeed day but always
 * includes those four. So a fixture day chosen from that intersection renders
 * in either file, whatever the rotation.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* Days both builds are guaranteed to train on. */
const SHARED_TRAINING_DAYS = ["Tuesday", "Wednesday", "Friday", "Sunday"];

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const TODAY = isoOf(new Date());

/* n days before `from` (default today), as an ISO date. */
function ago(n, from = TODAY) {
  const d = new Date(from + "T12:00:00");
  d.setDate(d.getDate() - n);
  return isoOf(d);
}

const dayOf = (iso) => DAY_NAMES[new Date(iso + "T12:00:00").getDay()];

/* The most recent training day that is today or earlier — never a future day,
 * so the app never labels the fixture's session "upcoming". Returns both the
 * weekday name and its date, since callers need the date for session keys. */
function fixtureDay(today = TODAY) {
  for (let back = 0; back < 7; back++) {
    const iso = ago(back, today);
    const name = dayOf(iso);
    if (SHARED_TRAINING_DAYS.includes(name)) return { day: name, date: iso, back };
  }
  /* unreachable: four of seven weekdays qualify */
  throw new Error("no shared training day in the last 7 days");
}

/* Same weekday, `weeks` weeks before the fixture day — for prior-session
 * history that lastEntryFor will find. */
function weeksBefore(weeks, from) {
  return ago(weeks * 7, from);
}

module.exports = { DAY_NAMES, SHARED_TRAINING_DAYS, TODAY, ago, dayOf, fixtureDay, weeksBefore, isoOf };
