# Franco Fit

A personal gym-tracking web app, built as two customized versions of one codebase.
Deployed on GitHub Pages. No build step, no framework tooling, no server code.

## Live URLs
- **Version A (Alicia):** `https://jteatime.github.io/fanco-fit/` → serves `index.html`
- **Version J (Franco):** `https://jteatime.github.io/fanco-fit/j.html`

Pushing to `main` auto-deploys via GitHub Pages (~1 minute). Users get updates on next
app open; their data lives in localStorage + Supabase, never in this repo.

## Repo layout
```
index.html              Version A — Alicia's app (full source inside)
j.html                  Version J — Franco's app (full source inside)
manifest.webmanifest    PWA manifest for Version A (start_url ./)
manifest-j.webmanifest  PWA manifest for Version J (start_url ./j.html)
apple-touch-icon.png    Home-screen icon (iOS, 180px)
icon-192.png            Icon (Android/favicon)
icon-512.png            Icon (Android)
CLAUDE.md               This file
```

## Architecture
Each HTML file is fully self-contained:
- React 18 UMD + Babel-standalone from cdnjs; all app code is JSX inside a single
  `<script type="text/babel">` tag. Babel compiles it in the browser at load.
- **No imports, no bundler.** `const { useState, ... } = React;` at the top.
- All persistence flows through one shim, `window_storage` (async get/set of a single
  JSON blob). It writes localStorage first (instant, offline-capable), then pushes the
  blob to Supabase in the background. On load, if localStorage is empty it pulls from
  Supabase automatically.
- Styling: one big template-literal stylesheet built by `buildCSS()` (re-evaluated each
  render so theme switching works) + inline styles. Colors come from the mutable `T`
  palette object; `applyTheme()` reassigns it.
- Mutable module state that re-renders read: `T` (palette), `DAYS`, `OPTIONAL_DAYS`,
  `CURRENT_THEME`. These are set by `applyTheme()` / `applySchedule()` which are called
  on load, restore, reseed, and when the user changes theme/refeed settings.

## The two versions — intentional differences
Both files contain ~95% identical code. **Any feature or fix must be applied to BOTH
files in parallel**, preserving these differences:

| Thing | index.html (A / Alicia) | j.html (J / Franco) |
|---|---|---|
| `STORAGE_KEY` | `franco-fit-a-v2` | `franco-fit-j-v1` |
| Seed function | `freshSeed()` — empty history, Cycle 1 starts today, unit lb, name Alicia, `refeedDay: "Saturday"`, `rewardId: "pink-heart"` | `seedJ()` — full historical sessions from the original spreadsheet (in `RAW`), kg, name Franco |
| `REFEED_ROTATION` | `true` (schedule rotates around selectable refeed day) | `false` (fixed schedule) |
| `DAYS` initial | Mon, Tue, Wed, Thu, Fri, Sun | Tue, Wed, Fri, Sun |
| `OPTIONAL_DAYS` initial | `{ Monday: true, Thursday: true }` | `{}` |
| `RAW` (routine seed) | Alicia's program (rep goals 8/12/6, set counts 3/6/2) | Franco's program with 4 weeks of logged history |
| `CELEBRATIONS` array | Alicia's personalized messages (explicit, written by Franco — **NEVER copy into J, never edit without being asked**) | Generic gym-hype messages |
| Manifest link in `<head>` | `manifest.webmanifest` | `manifest-j.webmanifest` |
| Reset button copy | "Reset app" / "start fresh" | "Reset to sheet data" / "re-import the sheet" |
| Connected-notes constants (`MY_INBOX`, `PARTNER_INBOX`, `MY_PUB`, `PARTNER_PUB`, `PARTNER_NAME`) | `MY_*` = the `-a` rows, `PARTNER_*` = the `-j` rows, `PARTNER_NAME` = "Jerold" | `MY_*` = the `-j` rows, `PARTNER_*` = the `-a` rows, `PARTNER_NAME` = "Alicia" |

## GOLDEN RULES — read before any edit
1. **Never change a `STORAGE_KEY`.** Changing it orphans the user's local data (the app
   would reseed). Cloud sync mitigates this but don't rely on it. Only change with
   explicit instruction and a migration plan.
2. **Never swap or "sync" the `CELEBRATIONS`, `RAW`, seed functions, or the
   differences table above between files.** They are different on purpose.
3. **Seed changes don't reach existing users.** `buildSeed()`/`freshSeed()`/`seedJ()`
   only run when storage is empty. Schedule/content changes for live users happen via
   the in-app Manage tab, or via data migrations in the load path (see the migration
   block in the load `useEffect`, e.g. `if (!parsed.theme) parsed.theme = "iron";`).
4. **Semantic colors are sacred:** green = beat previous, red = down, amber = tie/no
   comparison, blue = today/timer accent. Themes recolor surfaces and the accent, never
   the semantics. `pos`/`neg`/`amber` in `T` must not be themed.
5. **All performance comparisons are per exercise per machine (variant)** via
   `lastEntryFor(data, exId, variantId, excludeKey, beforeDate)`. Never compare across
   variants. Day-level comparisons use `dayVolume()` on whole sessions.
6. Preserve accessibility touches: `prefers-reduced-motion` disables all animations;
   keep aria-labels on icon buttons.

## Data model (the single JSON blob)
```
{
  version, unit ("kg"|"lb"), userName, nameAsked,
  theme ("iron"|"blossom"|"underwater"|"neon"|"jungle"|"rainbow"),
  rewardId (see REWARDS list), refeedDay (A only),
  cycleNumber, cycleName, cycleWeeks, cycleStart (ISO date),
  exercises: [{ id, day, name, icon?, prev, targetSets, repGoal?,
                variants: [{id, name}], activeVariant }],
  sessions: {
    "<ISO date>|<Day>": {
      date, day, startedAt?, finishedAt?, celebrated?, 
      entries: {
        [exerciseId]: { variantId, note, swapName, skippedAll?,
                        sets: [{ w, r, extra?, tag?, skipped?, skipNote? }] }
      }
    }
  }
}
```
- Week index = `weekOfCycle(data, iso)` — days since `cycleStart` / 7.
- `daySessionIn(data, day, week)` finds a session with real data for that slot.
- A set counts as done when `r > 0` or `skipped`. `skippedAll` marks a whole exercise
  skipped. `extra` sets never count toward the planned total (denominator).
- `celebrated` = the Finish Workout button was pressed (locks the button, enables the
  day's star/verdict on pills & heatmap).

## Key systems (where to look)
- **Set logging & targets:** `SetRow` — placeholder shows "beat last week" target
  (`floor(lastVol/weight)+1`) or the program rep goal; +/− adopt the target from empty;
  green/red coloring compares set-volume vs same-index set last time on same machine.
- **Weight cascade:** `changeSet` in `ExerciseCard` — typing a weight fills matching/
  blank sets below; clears never cascade.
- **Day status language:** `dayWeekStatus` + `DayStatusIcon` — star (won, only after
  finished), red dot (down), green dot (logged/in-progress), ✕ missed, dashed = optional
  rest, blue ring = today. The heatmap (`CycleGrid`) mirrors this exactly.
- **Start Workout / sticky bar:** `WorkoutBar` (elapsed + rest timer) pins to top while
  a session is active; `startedAt`/`finishedAt` produce the "· 58 min" on the button.
- **Rest timer:** blue → amber at 75 s → red + shake at 90 s → sassy lines ≥ 180 s.
- **Celebrations:** `fireCelebration` — random message with `{name}` substitution,
  refeed line on the day before `refeedDay`, `record` (gold confetti + NEW WEEKLY
  RECORD) when day volume beats prior week, `finale` (cycle recap) when the last
  scheduled day of the final week is finished.
- **Themes/rewards:** `THEMES`, `applyTheme`, `REWARDS`, `rewardOf`, `RewardGlyph`.
  Rainbow theme adds a gradient strip on cards via `RAINBOW_CSS`.
- **Easter egg:** 5 fast taps on the FRANCO FIT logo = theme disco (`onLogoTap`).
- **Export/backup:** CSV sheet export mirroring the original spreadsheet layout
  (`buildSheetRows`), JSON backup download + paste-to-restore, and Supabase sync codes.

## Supabase
One shared project for both versions; each app install writes its own row.
- Table (already created):
```sql
create table if not exists logs (
  id text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
alter table logs enable row level security;
create policy "open read"   on logs for select using (true);
create policy "open insert" on logs for insert with check (true);
create policy "open update" on logs for update using (true);
```
- Credentials live near the top of each HTML's script: `SUPABASE_URL` and
  `SUPABASE_ANON_KEY`. Same values in both files. The anon key is public by design;
  the per-install random `sync code` (row id, stored at `<STORAGE_KEY>:sync-id` in
  localStorage) is the actual secret. Never log or commit sync codes.
- If credentials are placeholders (`PASTE_...`), the cloud layer silently disables and
  the app is local-only. Cloud writes are fire-and-forget; reads happen only when
  localStorage is empty or the user enters a code in Manage → Data → Cloud sync.

## Connected notes (the two-user love-note mailbox)
The only cross-user feature. Each user writes their partner's **end-of-workout
celebration message** for a chosen workout day; it replaces the random
`CELEBRATIONS` line when the partner finishes that (or their next) session.
- **Four fixed Supabase rows**, ids identical in both files, `MY_*`/`PARTNER_*`
  swapped per version (see differences table). Each row is **single-writer**:
  - `inbox-<user>` — the note queue *for* that user; written only by the partner
    (`PARTNER_INBOX`), read by the user (`MY_INBOX`). Shape `{ notes: [{ id, date,
    text, createdAt }] }`. The sender's local `data.sentNotes` is the source of
    truth; every add/delete re-pushes the whole array.
  - `pub-<user>` — written only by that user (`MY_PUB`), read by the partner
    (`PARTNER_PUB`). Shape `{ schedule, acks, name }`. `schedule` (from
    `mySchedulePayload`) drives the composer's workout-day chips via
    `upcomingWorkoutDates`; `acks` (`{ noteId: seenISO }`, mirrored from the
    recipient's local `data.noteAcks`) are the **read receipts**.
- **Delivery** (`fireCelebration`): pick the oldest note with `date <= session
  date` not already in `noteAcks`; use its text (with `{name}` substitution), tag
  the celebration `from: PARTNER_NAME`, and `deliverNote()` (records the ack +
  republishes `MY_PUB`). Undelivered notes roll forward to the next finish;
  future-dated notes wait. The Finish button re-fetches the inbox first so a
  just-sent note is caught.
- **New blob fields:** `sentNotes: []`, `noteAcks: {}` (both in `buildSeed` +
  load-migration). Composer UI lives in Manage → "Note to <partner>".
- **Auto-prune:** when the composer loads and reads the partner's `acks`, any
  sent note that's been seen is removed from `sentNotes` and re-pushed out of the
  inbox row (frees its photo from cloud + local storage). So the "sent" list is
  effectively an outbox of *undelivered* notes; seen notes disappear.
- **Photo attachments:** a note may carry an optional `image` (compressed JPEG
  data URI). `compressImage(file, 1000, 0.6)` downscales on-device before it's
  ever stored (~80–150 KB) — there is no raw-image path. The image rides inside
  the note JSON (inbox row + sender's local queue); the recipient renders it
  from memory and never persists it. A photo note makes the `Celebration`
  overlay **stay open until tapped** (no 5s auto-close).
- **Privacy:** notes ride the public anon key like everything else; the random
  row ids are the only guard. Never log them. No auth, no realtime.

## Workflow for changes
1. Edit **both** `index.html` and `j.html` (respecting the differences table). For a
   version-specific request, touch only that file.
2. **Verify before committing** — extract and compile each file's JSX:
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');fs.writeFileSync('/tmp/a.jsx',h.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/)[1])" && npx --yes esbuild /tmp/a.jsx --loader:.jsx=jsx --outfile=/dev/null
node -e "const fs=require('fs');const h=fs.readFileSync('j.html','utf8');fs.writeFileSync('/tmp/j.jsx',h.match(/<script type=\"text\/babel\"[^>]*>([\s\S]*?)<\/script>/)[1])" && npx --yes esbuild /tmp/j.jsx --loader:.jsx=jsx --outfile=/dev/null
```
   Both must compile clean. Optionally sanity-test locally: `python3 -m http.server`
   then open `http://localhost:8000/j.html`.
3. Commit with a clear message and push to `main`. That IS the deploy.
4. Remind the user: phones may serve a cached copy for a few minutes; force-closing the
   home-screen app refreshes it. Icon changes additionally require delete + re-add of
   the home-screen shortcut (data survives thanks to cloud sync — but confirm sync codes
   are saved first).