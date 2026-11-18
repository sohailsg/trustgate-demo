(function () {
  const $ = id => document.getElementById(id);
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in (props || {})) {
      if (k === "class") e.className = props[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const KEY = "trustgate_demo_v2";
  const fresh = () => ({ rulings: {}, tickets: [], log: [], counts: { verified: 0, conflict: 0, lowconf: 0, cannot: 0, ruled: 0, stale: 0 }, n: 0, userDocs: [], retired: [], last: "" });
  let state = fresh();
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.counts) state = Object.assign(fresh(), s); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  const LABEL = { verified: "VERIFIED", conflict: "CONFLICT DETECTED", lowconf: "LOW CONFIDENCE", cannot: "CANNOT ANSWER", ruled: "REVIEWER RULING APPLIED", stale: "SOURCE NEEDS REVIEW" };
  const ICON = { pass: "✓", flag: "!", stop: "✕", skip: "–" };
  const docs = () => DOCS.concat(state.userDocs).map(d => state.retired.includes(d.id) ? Object.assign({}, d, { status: "superseded" }) : d);
  const ownerOf = r => (r.citations && r.citations[0] && r.citations[0].owner) || "Policy desk";

  const citeChip = c => h("span", { class: "chip" }, c.title + " " + c.version + " · §" + c.section + " · eff. " + c.effective);
  function passage(c, terms, tag) {
    const p = h("p", {}, "“");
    TG.segments(c.text, terms).forEach(s => p.append(s.hit ? h("mark", {}, s.t) : document.createTextNode(s.t)));
    p.append("”");
    return h("div", { class: "passage" }, h("div", { class: "pmeta" }, citeChip(c), c.stale ? h("span", { class: "tag stale" }, "overdue for review") : null, tag ? h("span", { class: "tag cannot" }, tag) : null), p);
  }

  function renderTrace(r) {
    const t = r.trace, d = h("details", { class: "trace" }, h("summary", {}, "How TrustGate decided"));
    d.setAttribute("open", "");
    const st = h("div", { class: "stages" });
    t.stages.forEach((s, i) => st.append(h("div", { class: "stage " + s.state }, h("b", {}, ICON[s.state] + " " + (i + 1) + ". " + s.name), h("span", {}, s.detail))));
    d.append(st);
    const cov = Math.round(r.confidence * 100), g = r.thresholds.green * 100, rd = r.thresholds.red * 100;
    d.append(h("div", { class: "sub" }, "Evidence coverage: " + cov + "% of the question's weighted terms appear in the best approved passage"));
    d.append(h("div", { class: "bar" }, h("i", { class: cov >= g ? "g" : cov < rd ? "r" : "", style: "width:" + Math.min(100, cov) + "%" }), h("u", { style: "left:" + rd + "%" }), h("u", { style: "left:" + g + "%" })));
    d.append(h("div", { class: "barl" }, h("span", { style: "left:" + rd + "%" }, "refuse below " + rd + "%"), h("span", { style: "left:" + Math.min(g + 12, 88) + "%" }, "answer from " + g + "%")));
    const tm = h("div", { class: "terms" });
    t.terms.forEach(x => tm.append(h("span", { class: x.hit ? "hit" : "miss" }, (x.hit ? "✓ " : "✕ ") + x.t)));
    d.append(h("div", { class: "sub" }, "Question terms: green found in the evidence, red not found"), tm);
    return d;
  }

  function renderResult(r, ticket) {
    const box = $("result"); box.textContent = "";
    const card = h("div", { class: "rcard " + r.status });
    card.append(h("div", { class: "badge " + r.status }, LABEL[r.status]));
    card.append(h("div", { class: "q" }, "Q: " + r.question));
    const T = r.queryTerms;
    if (r.status === "verified" || r.status === "ruled" || r.status === "stale") {
      card.append(h("p", { class: "ans" }, r.answerText));
      if (r.reason) card.append(h("p", { class: "meta" }, r.reason));
      card.append(h("div", { class: "sub" }, r.citations.length > 1 ? (r.status === "verified" ? "All " + r.citations.length + " sources agree. Sources:" : "Sources:") : "Source:"));
      r.citations.forEach(c => card.append(passage(c, T)));
    } else if (r.status === "conflict") {
      card.append(h("p", { class: "ans" }, "I cannot give one answer. " + r.reason));
      if (r.note) card.append(h("p", { class: "meta" }, r.note));
      const row = h("div", { class: "cols" }); r.citations.forEach(c => row.append(passage(c, T))); card.append(row);
    } else if (r.status === "lowconf") {
      card.append(h("p", { class: "ans" }, r.reason), h("div", { class: "sub" }, "Closest match (not an answer):"));
      r.citations.forEach(c => card.append(passage(c, T)));
    } else {
      card.append(h("p", { class: "ans" }, r.reason));
      if (r.citations && r.citations.length) r.citations.forEach(c => card.append(passage(c, T, "not approved")));
    }
    if (r.warnings.length) { const ul = h("ul", { class: "warns" }); r.warnings.forEach(w => ul.append(h("li", {}, w))); card.append(ul); }
    if (ticket) card.append(h("div", { class: "esc" }, "Escalated: ticket " + ticket.id + " sent to " + ticket.owner + ". Status: awaiting review."));
    card.append(renderTrace(r));
    box.append(card);
  }

  function ask(q) {
    q = q.trim(); if (!q) return;
    state.last = q;
    const r = TG.answer(q, docs(), state.rulings, { today: TODAY });
    state.counts[r.status]++;
    let ticket = null;
    if (["conflict", "lowconf", "cannot", "stale"].includes(r.status)) {
      ticket = state.tickets.find(t => t.q === q && t.status === "open");
      if (!ticket) {
        ticket = { id: "T-" + String(++state.n).padStart(3, "0"), q, kind: r.status, topic: r.topic, owner: ownerOf(r), cites: r.citations, status: "open", resolution: "", opened: new Date().toLocaleTimeString() };
        state.tickets.unshift(ticket);
      }
    }
    state.log.unshift({ t: new Date().toLocaleTimeString(), q, s: r.status, c: (r.citations || []).map(c => c.docId + "§" + c.section).join(", ") || "none" });
    renderResult(r, ticket); renderAll();
  }

  function resolve(t, ruling, text) {
    t.status = "resolved"; t.resolution = text;
    if (ruling && t.topic) state.rulings[t.topic] = Object.assign({}, ruling, { sig: t.cites.map(c => c.docId).sort().join("|") });
    state.log.unshift({ t: new Date().toLocaleTimeString(), q: "[Reviewer] " + t.id + ": " + text, s: "ruled", c: t.topic || "n/a" });
    if (ruling && state.last) { $("qin").value = state.last; ask(state.last); } else renderAll();
  }

  function renderQueue() {
    const box = $("queue"); box.textContent = "";
    if (!state.tickets.length) box.append(h("p", { class: "empty" }, "No escalations yet. Ask a question that hits a conflict or has no source."));
    state.tickets.forEach(t => {
      const c = h("div", { class: "ticket " + t.status });
      c.append(h("div", { class: "thead" }, h("b", {}, t.id), h("span", { class: "tag " + t.kind }, { cannot: "no source", lowconf: "low confidence", conflict: "conflict", stale: "stale source" }[t.kind]), h("span", { class: "st" }, t.status === "open" ? "Awaiting review" : "Resolved")));
      c.append(h("div", { class: "tq" }, t.q), h("div", { class: "tm" }, "Owner: " + t.owner + " · opened " + t.opened));
      if (t.status === "open") {
        const acts = h("div", { class: "acts" });
        if (t.kind === "conflict") {
          t.cites.forEach(ci => acts.append(h("button", { onclick: () => resolve(t, { type: "prefer", docId: ci.docId }, "Use " + ci.title + " " + ci.version) }, "Use " + ci.title + " " + ci.version)));
          acts.append(h("button", { onclick: () => resolve(t, { type: "both" }, "Both valid, different scope") }, "Both valid"));
        } else acts.append(h("button", { onclick: () => resolve(t, null, t.kind === "stale" ? "Review requested from owner" : "Source requested from owner") }, t.kind === "stale" ? "Request review" : "Request a source"));
        c.append(acts);
      } else c.append(h("div", { class: "tm" }, "Decision: " + t.resolution));
      box.append(c);
    });
    const rb = $("rulings"); rb.textContent = "";
    const keys = Object.keys(state.rulings);
    if (keys.length) {
      rb.append(h("div", { class: "sub" }, "Active reviewer rulings"));
      keys.forEach(k => rb.append(h("div", { class: "ticket" }, h("div", { class: "tm" }, k + ": " + (state.rulings[k].type === "both" ? "both valid" : "use " + state.rulings[k].docId)),
        h("div", { class: "acts" }, h("button", { onclick: () => { delete state.rulings[k]; state.log.unshift({ t: new Date().toLocaleTimeString(), q: "[Reviewer] ruling withdrawn", s: "ruled", c: k }); renderAll(); } }, "Undo ruling")))));
    }
  }

  function renderLog() {
    const box = $("log"); box.textContent = "";
    state.log.slice(0, 10).forEach(l => box.append(h("div", { class: "lrow" }, h("span", { class: "lt" }, l.t), h("span", { class: "tag " + l.s }, l.s), h("span", { class: "lq" }, l.q + " → " + l.c))));
    if (!state.log.length) box.append(h("p", { class: "empty" }, "Every question and reviewer decision is logged here."));
  }

  function renderStats() {
    const c = state.counts, total = Object.values(c).reduce((a, b) => a + b, 0), box = $("stats"); box.textContent = "";
    [["Questions asked", total], ["Answered with sources", c.verified + c.ruled], ["Escalated to a person", c.conflict + c.lowconf + c.cannot + c.stale], ["Open tickets", state.tickets.filter(t => t.status === "open").length]]
      .forEach(([k, v]) => box.append(h("div", { class: "stat" }, h("b", {}, v), h("span", {}, k))));
  }

  function renderLibrary() {
    const box = $("library"); box.textContent = "";
    docs().forEach(d => {
      const isUser = state.userDocs.some(u => u.id === d.id), retired = state.retired.includes(d.id), orig = DOCS.concat(state.userDocs).find(x => x.id === d.id);
      const lis = h("ul", { class: "dsecs" }); d.sections.forEach(s => lis.append(h("li", {}, "§" + s.id + " " + s.text)));
      const stale = d.status === "active" && d.reviewBy < TODAY;
      box.append(h("div", { class: "doc " + d.status },
        h("div", { class: "dh" }, h("div", {}, h("div", { class: "dt" }, d.title + " " + d.version), h("div", { class: "dm" }, d.effective + " · " + d.owner + (stale ? " · review overdue" : ""))), h("span", { class: "tag " + d.status }, d.status)),
        h("details", {}, h("summary", {}, d.sections.length + " section" + (d.sections.length > 1 ? "s" : "")), lis),
        orig && orig.status === "active" ? h("button", { onclick: () => { retired ? state.retired.splice(state.retired.indexOf(d.id), 1) : state.retired.push(d.id); renderAll(); } }, retired ? "Restore" : "Retire") : null,
        isUser ? h("button", { onclick: () => { state.userDocs = state.userDocs.filter(u => u.id !== d.id); renderAll(); } }, "Remove") : null));
    });
  }

  function addDoc(ev) {
    ev.preventDefault();
    const title = $("dtitle").value.trim(), ver = $("dver").value.trim() || "v1", date = $("ddate").value || TODAY, msg = $("dmsg");
    const lines = $("dtext").value.split("\n").map(l => l.trim()).filter(Boolean);
    if (!title) { msg.textContent = "Please enter a title."; return; }
    if (!lines.length || lines.length > 12) { msg.textContent = "Add between 1 and 12 section lines."; return; }
    if (lines.some(l => l.length > 400)) { msg.textContent = "Each section must be under 400 characters."; return; }
    const id = (title.replace(/[^A-Za-z0-9]+/g, "-").toUpperCase() + "-" + ver).slice(0, 40);
    if (docs().some(d => d.id === id)) { msg.textContent = "That title and version already exist. Change the version."; return; }
    const base = docs(), secs = [];
    lines.forEach((l, i) => {
      const m = l.match(/^([0-9][0-9.]*)\s*:\s*(.+)$/), sid = m ? m[1] : String(i + 1), text = (m ? m[2] : l).trim();
      const topic = TG.assignTopic(text, base.concat([{ sections: secs }])) || "custom-" + id + "-" + sid;
      secs.push({ id: sid, topic, text });
    });
    const next = new Date(date); next.setFullYear(next.getFullYear() + 1);
    state.userDocs.push({ id, family: title.toUpperCase(), title, version: ver, effective: date, reviewBy: isNaN(next) ? "2027-11-18" : next.toISOString().slice(0, 10), status: "active", owner: "Uploader (you)", sections: secs });
    msg.textContent = "Added. Topics were matched to existing sections automatically. Ask a question to see the effect.";
    $("dtitle").value = ""; $("dtext").value = "";
    renderAll();
  }

  function exportCsv() {
    const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = [["time", "event", "status", "sources"]].concat(state.log.slice().reverse().map(l => [l.t, l.q, l.s, l.c]));
    const blob = new Blob([rows.map(r => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "trustgate_audit_log.csv" });
    document.body.append(a); a.click(); a.remove();
  }

  function evalBlock(title, note, r) {
    const wrap = h("div", { style: "margin-top:14px" }, h("div", { class: "sub" }, title));
    const k = h("div", { class: "evalgrid" },
      h("div", { class: "kpi" }, h("b", {}, r.correct + " / " + r.total), h("span", {}, "expected outcome")),
      h("div", { class: "kpi" }, h("b", { class: r.unsafe.length ? "fail" : "pass" }, r.unsafe.length), h("span", {}, "confident but wrong")));
    wrap.append(k, h("p", { class: "meta" }, note));
    const t = h("table", {}, h("tr", {}, h("th", {}, "Question"), h("th", {}, "Expected"), h("th", {}, "Got"), h("th", {}, "")));
    r.rows.slice().sort((a, b) => a.ok - b.ok).forEach(x => t.append(h("tr", { class: x.ok ? "" : "bad" }, h("td", {}, x.q), h("td", {}, x.expect), h("td", {}, x.got), h("td", { class: x.ok ? "pass" : "fail" }, x.ok ? "✓" : "✗"))));
    wrap.append(h("details", { open: r.correct < r.total ? "" : null }, h("summary", {}, "Question-level results (failures first)"), h("div", { class: "tw" }, t)));
    return wrap;
  }
  function runEval() {
    const box = $("evalout"); box.textContent = "";
    const a = TG.evaluate(DOCS, EVAL_TUNE, TODAY), b = TG.evaluate(DOCS, EVAL_TEST, TODAY);
    box.append(evalBlock("Held-out set (written after thresholds were fixed)", "First run scored 17 of 20. Two generic text fixes followed (word endings such as submitted/submit, and treating “long” as a question word). No thresholds were changed. The remaining misses are shown, not hidden.", b));
    const conf = h("table", {}, h("tr", {}, h("th", {}, "Expected \\ Got"), b.classes.map(c => h("th", {}, c))));
    b.classes.forEach(e => { if (b.byClass[e].n) conf.append(h("tr", {}, h("td", {}, e), b.classes.map(g => h("td", {}, b.confusion[e][g] || "·")))); });
    box.append(h("details", {}, h("summary", {}, "Confusion matrix (held-out)"), h("div", { class: "tw" }, conf)));
    box.append(evalBlock("Tuning set (used while setting thresholds, so optimistic)", "", a));
    box.append(h("p", { class: "meta" }, "Small synthetic sets that illustrate the evaluation method. They are not a benchmark and do not predict accuracy on real documents. The measure that matters most is “confident but wrong”."));
  }

  function renderAll() { renderLibrary(); renderQueue(); renderLog(); renderStats(); save(); }

  function init() {
    TOUR.forEach(s => $("tour").append(h("button", { class: "tourbtn", onclick: () => { $("qin").value = s.q; $("tourcap").textContent = s.cap; ask(s.q); } }, s.label)));
    [...EVAL_TUNE.slice(0, 9), EVAL_TEST[3], EVAL_TEST[12]].forEach(e => $("chips").append(h("button", { class: "qchip", onclick: () => { $("qin").value = e.q; ask(e.q); } }, e.q)));
    $("askform").addEventListener("submit", ev => { ev.preventDefault(); ask($("qin").value); });
    $("addform").addEventListener("submit", addDoc);
    $("dexample").addEventListener("click", () => { $("dtitle").value = "HR Leave Policy"; $("dver").value = "v5"; $("dtext").value = "4.2: Unused annual leave may be carried over to the next year, up to 10 days."; $("dmsg").textContent = "Now click Add, then ask: How many leave days can I carry over to next year?"; });
    $("ddate").value = TODAY;
    $("evalbtn").addEventListener("click", runEval);
    $("exportbtn").addEventListener("click", exportCsv);
    $("resetbtn").addEventListener("click", () => { state = fresh(); $("result").textContent = ""; $("evalout").textContent = ""; $("tourcap").textContent = "Demo reset."; renderAll(); });
    renderAll();
  }
  init();
})();
