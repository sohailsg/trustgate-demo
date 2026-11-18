const { DOCS, EVAL_TUNE, EVAL_TEST, TODAY } = require("./data.js");
global.TODAY = TODAY;
const { answer, evaluate } = require("./engine.js");
function show(name, set) {
  const r = evaluate(DOCS, set, TODAY);
  console.log("== " + name + ": " + r.correct + "/" + r.total + "  unsafe(confident-but-wrong): " + r.unsafe.length);
  for (const x of r.rows) console.log((x.ok ? "OK  " : "FAIL"), x.expect.padEnd(8), x.got.padEnd(8), x.confidence.toFixed(2), x.q);
}
show("TUNE", EVAL_TUNE);
show("HELD-OUT", EVAL_TEST);
const k = answer("How many leave days can I carry over to next year?", DOCS);
console.log(k.status, k.note, k.warnings);
console.log(JSON.stringify(k.trace.stages.map(s => s.name + ":" + s.state)));
