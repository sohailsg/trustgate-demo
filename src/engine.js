// TrustGate engine: rule-based and extractive. It never generates new policy text.
const STOP = new Set("a an the is are am was were be do does did i me my we our you your can could should would may might will shall how what when where which who whom why many much to of in on at for from by with and or if it its this that these those there any get got have has had need needs about into than then so as not no use used using must long".split(" "));
const SYN = { carried: "carry", carrying: "carry", carries: "carry", home: "remote", wfh: "remote", remotely: "remote", telework: "remote", quotes: "quote", bids: "quote", pwd: "password", resignation: "resign", resigns: "resign", phone: "device", mobile: "device" };
let T_GREEN = 0.6, T_RED = 0.45;
const INJECT_RE = /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(rules?|instructions?|polic(?:y|ies)|previous|above)\b/i;
const FACT_RE = /(\d[\d,]*)\s*(days?|hours?|characters|USD|months?|quotes?|percent)/gi;
const NEG_RE = /\b(must not|may not|not allowed|prohibited|forbidden|cannot|not permitted)\b/i;
const POS_RE = /\b(may|allowed|permitted|can)\b/i;

function stem(w) {
  w = SYN[w] || w;
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  if (w.length > 3 && /(bb|gg|mm|nn|pp|rr|tt)$/.test(w)) w = w.slice(0, -1); // submitted -> submitt -> submit
  return w;
}
function tokens(s) {
  return s.toLowerCase().replace(/(\d),(\d)/g, "$1$2").split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t)).map(stem);
}
function facts(text) {
  const out = new Set(); let m; FACT_RE.lastIndex = 0;
  while ((m = FACT_RE.exec(text))) out.add(m[1].replace(/,/g, "") + " " + m[2].toLowerCase().replace(/s$/, ""));
  return out;
}
const polarity = t => NEG_RE.test(t) ? -1 : POS_RE.test(t) ? 1 : 0;
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
const isStale = (d, today) => !!d.reviewBy && d.reviewBy < today;

function buildIndex(docs) {
  const secs = [];
  for (const d of docs) for (const s of d.sections) secs.push({ doc: d, sec: s, toks: new Set(tokens(d.title + " " + s.text)), facts: facts(s.text), pol: polarity(s.text) });
  const df = {};
  for (const s of secs) for (const t of s.toks) df[t] = (df[t] || 0) + 1;
  const N = secs.length;
  return { secs, idf: t => Math.log(1 + N / (1 + (df[t] || 0))) };
}

function conflicting(a, b) {
  if (!sameSet(a.facts, b.facts)) return true;
  return a.pol !== 0 && b.pol !== 0 && a.pol !== b.pol;
}

// rulings: { [topic]: {type:"prefer", docId} | {type:"both"} }
function answer(question, docs, rulings = {}, opts = {}) {
  const today = opts.today || (typeof TODAY !== "undefined" ? TODAY : "2026-11-18");
  const injected = INJECT_RE.test(question);
  const cleaned = injected ? question.replace(INJECT_RE, " ").replace(/\b(and|then|tell me|say)\b/gi, " ") : question;
  const { secs, idf } = buildIndex(docs);
  const q = [...new Set(tokens(cleaned))];
  const qTotal = q.reduce((a, t) => a + idf(t), 0) || 1;
  const score = list => list.map(s => {
    const matched = q.filter(t => s.toks.has(t));
    const m = matched.reduce((a, t) => a + idf(t), 0);
    const sTotal = [...s.toks].reduce((a, t) => a + idf(t), 0) || 1;
    const tb = tokens(s.sec.topic.replace(/-/g, " ")).filter(x => q.includes(x)).reduce((a, x) => a + idf(x), 0);
    return { s, matched, cov: m / qTotal, rank: m / qTotal + 0.3 * (m / sTotal) + 0.3 * (tb / qTotal) };
  }).sort((a, b) => b.rank - a.rank);

  const approved = score(secs.filter(s => s.doc.status === "active"));
  const drafts = score(secs.filter(s => s.doc.status === "draft"));
  const top = approved[0];
  const cite = x => ({ docId: x.doc.id, title: x.doc.title, version: x.doc.version, effective: x.doc.effective, section: x.sec.id, text: x.sec.text, owner: x.doc.owner, stale: isStale(x.doc, today) });
  const warnings = [];
  if (injected) warnings.push("Instruction-like text in the question was ignored. Questions are treated as data, never as commands.");
  const termsFor = x => q.map(t => ({ t, hit: x ? x.matched.includes(t) : false }));
  const stages = [
    { name: "Retrieve", state: "stop", detail: "No approved passage found" },
    { name: "Conflicts", state: "skip", detail: "Skipped" },
    { name: "Coverage", state: "skip", detail: "Skipped" },
    { name: "Verify", state: "skip", detail: "Skipped" },
    { name: "Route", state: "stop", detail: "Refused" }
  ];
  const base = { question, queryTerms: q, warnings, thresholds: { green: T_GREEN, red: T_RED }, injected };
  const finish = (r, tr) => ({ ...base, ...r, trace: { stages, terms: tr, coverage: r.confidence } });

  if (!top || top.cov < T_RED) {
    const d = drafts[0];
    let reason = "No approved document covers this question well enough. The system will not guess.";
    let citations = [];
    if (d && d.cov >= T_RED) {
      reason = "Only an unapproved draft covers this. Drafts are never used as answer sources.";
      citations = [cite(d.s)];
      warnings.push("Excluded draft: " + d.s.doc.title + " " + d.s.doc.version + " (not approved).");
    }
    stages[0].detail = top ? "Best match covers " + Math.round(top.cov * 100) + "% (below " + Math.round(T_RED * 100) + "%)" : "Library empty";
    stages[4].detail = "Refused and escalated";
    return finish({ status: "cannot", confidence: top ? top.cov : 0, reason, citations, excluded: citations.length > 0, supersededNotes: [] }, termsFor(top));
  }

  const topic = top.s.sec.topic;
  const hitsScored = approved.filter(x => x.s.sec.topic === topic && x.cov >= T_RED);
  const hits = hitsScored.map(x => x.s);
  const common = { topic, confidence: top.cov, citations: hits.map(cite), supersededNotes: secs.filter(s => s.doc.status === "superseded" && s.sec.topic === topic).map(cite) };
  const terms = termsFor(top);
  stages[0] = { name: "Retrieve", state: "pass", detail: hits.length + " approved passage" + (hits.length > 1 ? "s" : "") + " on “" + topic + "”" };
  if (common.supersededNotes.length) warnings.push("Excluded: superseded version " + common.supersededNotes[0].title + " " + common.supersededNotes[0].version + " says “" + common.supersededNotes[0].text + "”");
  const staleDocs = hits.filter(h => isStale(h.doc, today));
  if (staleDocs.length) warnings.push(staleDocs.map(h => h.doc.title + " " + h.doc.version).join(", ") + " is past its review date (" + staleDocs[0].doc.reviewBy + ").");

  if (top.cov < T_GREEN) {
    stages[1] = { name: "Conflicts", state: "pass", detail: "Not checked, evidence too thin" };
    stages[2] = { name: "Coverage", state: "flag", detail: Math.round(top.cov * 100) + "% (needs " + Math.round(T_GREEN * 100) + "%)" };
    stages[4] = { name: "Route", state: "flag", detail: "Shown as reference, escalated" };
    return finish({ ...common, status: "lowconf", citations: [cite(top.s)], reason: "The closest passage covers only part of the question. Shown for reference, not as an answer." }, terms);
  }
  stages[2] = { name: "Coverage", state: "pass", detail: Math.round(top.cov * 100) + "% of question terms evidenced" };

  const disagree = hits.length > 1 && hits.some(h => conflicting(h, hits[0]));
  if (disagree) {
    stages[1] = { name: "Conflicts", state: "flag", detail: "Sources disagree on the same topic" };
    const sig = hits.map(h => h.doc.id).sort().join("|");
    const ruling = rulings[topic] && rulings[topic].sig === sig ? rulings[topic] : null;
    if (rulings[topic] && !ruling) warnings.push("An earlier reviewer ruling on this topic was not applied because the set of sources has changed since it was made.");
    if (ruling) {
      stages[3] = { name: "Verify", state: "pass", detail: "Answer text is a verbatim source passage" };
      stages[4] = { name: "Route", state: "pass", detail: "Answered under reviewer ruling" };
      const chosen = ruling.type === "prefer" ? hits.find(h => h.doc.id === ruling.docId) : null;
      return finish({ ...common, status: "ruled", ruling,
        answerText: ruling.type === "both" ? "Reviewer ruling: both rules are valid and apply to different situations. See both sources below." : "Reviewer ruling: " + (chosen ? chosen.sec.text : "") }, terms);
    }
    const sorted = [...hits].sort((a, b) => b.doc.effective.localeCompare(a.doc.effective));
    const fam = new Set(hits.map(h => h.doc.title));
    const note = fam.size === 1
      ? "Both versions of this policy are listed as active. The newer one is " + sorted[0].doc.version + " (" + sorted[0].doc.effective + "), but the older one was never retired."
      : "Different policies give different values for the same topic.";
    stages[4] = { name: "Route", state: "flag", detail: "Both shown, escalated" };
    return finish({ ...common, status: "conflict", reason: "Sources disagree. Both are shown and the case is escalated. The system does not pick a side.", note }, terms);
  }
  stages[1] = { name: "Conflicts", state: "pass", detail: hits.length > 1 ? "All " + hits.length + " sources agree" : "Single source, none to compare" };
  const answerText = hits[0].sec.text;
  const verified = hits.some(h => h.sec.text.includes(answerText));
  stages[3] = { name: "Verify", state: verified ? "pass" : "stop", detail: verified ? "Answer text is a verbatim source passage" : "Citation does not support answer" };
  if (hits.every(h => isStale(h.doc, today))) {
    stages[4] = { name: "Route", state: "flag", detail: "Answered with warning, review requested" };
    return finish({ ...common, status: "stale", answerText, reason: "Every source for this answer is past its review date. Treat it as unconfirmed." }, terms);
  }
  stages[4] = { name: "Route", state: "pass", detail: "Answer delivered with citations" };
  return finish({ ...common, status: "verified", answerText }, terms);
}

function segments(text, qTerms) {
  return text.split(/([A-Za-z0-9,]+)/).filter(p => p !== "").map(p => ({ t: p, hit: /[A-Za-z0-9]/.test(p) && tokens(p).some(x => qTerms.includes(x)) }));
}

// Assign a topic to pasted text by overlap with existing sections (null = new topic).
function assignTopic(text, docs) {
  const A = new Set(tokens(text)); let best = null, bs = 0;
  for (const d of docs) for (const s of d.sections) {
    const B = new Set(tokens(s.text));
    const inter = [...A].filter(x => B.has(x)).length;
    const sc = inter / (Math.min(A.size, B.size) || 1);
    if (sc > bs) { bs = sc; best = s.topic; }
  }
  return bs >= 0.5 ? best : null;
}

function evaluate(docs, set, today) {
  const classes = ["verified", "conflict", "stale", "lowconf", "cannot"];
  const rows = set.map(e => { const r = answer(e.q, docs, {}, { today }); return { q: e.q, expect: e.expect, got: r.status, ok: r.status === e.expect, confidence: r.confidence }; });
  const confusion = {};
  classes.forEach(c => { confusion[c] = {}; classes.forEach(g => confusion[c][g] = 0); });
  rows.forEach(r => { if (confusion[r.expect]) confusion[r.expect][r.got] = (confusion[r.expect][r.got] || 0) + 1; });
  const byClass = {};
  classes.forEach(c => {
    const tp = rows.filter(r => r.expect === c && r.got === c).length, fp = rows.filter(r => r.expect !== c && r.got === c).length, fn = rows.filter(r => r.expect === c && r.got !== c).length;
    byClass[c] = { tp, fp, fn, n: tp + fn };
  });
  // The costly error: a question with no valid answer that got a confident answer.
  const unsafe = rows.filter(r => ["cannot", "conflict", "stale"].includes(r.expect) && r.got === "verified");
  return { rows, correct: rows.filter(r => r.ok).length, total: rows.length, confusion, byClass, classes, unsafe };
}

if (typeof module !== "undefined") module.exports = { answer, evaluate, tokens, facts, segments, assignTopic };
var TG = { answer, evaluate, segments, assignTopic, tokens };
