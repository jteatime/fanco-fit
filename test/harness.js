/* Loads the real shipped script out of an HTML file and returns its top-level
   values, so tests exercise the deployed code rather than a copy of it. */
const fs = require("fs");
const cp = require("child_process");
const path = require("path");

module.exports = function load(htmlPath, names, tmpdir) {
  const html = fs.readFileSync(htmlPath, "utf8");
  let body = html.match(/<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/)[1];
  /* drop the single top-level side effect: the React mount */
  body = body.replace(/ReactDOM\.createRoot\([\s\S]*?\);\s*$/, "");
  body += `\nmodule.exports = { ${names.join(", ")} };\n`;
  const jsx = path.join(tmpdir, path.basename(htmlPath) + ".probe.jsx");
  const out = path.join(tmpdir, path.basename(htmlPath) + ".probe.js");
  fs.writeFileSync(jsx, body);
  cp.execFileSync("npx", ["--yes", "esbuild", jsx, "--loader:.jsx=jsx",
    "--format=cjs", "--platform=node", "--jsx-factory=h", "--jsx-fragment=Frag",
    "--outfile=" + out], { stdio: "pipe" });

  const store = {};
  global.h = () => null;
  global.Frag = null;
  global.React = {
    useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }),
    useMemo: (f) => f(), useCallback: (f) => f, createElement: () => null, Fragment: null,
  };
  global.ReactDOM = { createRoot: () => ({ render: () => {} }) };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  global.document = {
    getElementById: () => null,
    documentElement: { style: { setProperty() {} } },
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, click() {} }),
    head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} },
  };
  global.window = global;
  global.fetch = () => Promise.resolve({ ok: false, json: () => ({}) });
  global.navigator = { userAgent: "node" };
  global.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  return require(out);
};
