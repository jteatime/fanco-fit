# Tests

Verification scripts for `index.html` and `j.html`. **The app itself still has
no build step** — these scripts never run in the browser and nothing in the
HTML files imports them.

    cd test && npm install

- `superset-logic.test.js` — pure helpers, run with `node`
- `superset-render.test.js` — react-dom/server render assertions
- `logging-regression.test.js` — real Chrome, single-exercise logging
- `superset-ui.test.js` — real Chrome, link/log/unlink

The Chrome tests need a local server and the installed Google Chrome:

    python3 -m http.server 8777     # from the repo root
    node test/logging-regression.test.js j.html
