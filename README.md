# TrustGate

Prototype for BUILD2RISE 2026, Problem Statement 3: Trust Before Automation.
Team: Data and Dollars (Sohail Ahmed, FORE School of Management).

TrustGate answers questions only from approved documents, cites the exact source passage, flags conflicting or stale sources, and escalates uncertain cases to a human reviewer.

**Live demo:** https://sohailsg.github.io/trustgate-demo/

## What the prototype does
- Retrieves from a library of 14 synthetic policy documents (active, superseded and draft).
- Returns one of: verified, conflict, low confidence, cannot answer, stale source, or reviewer ruling applied.
- Shows a five-stage decision trace and which question terms had evidence.
- Escalates to a reviewer queue; reviewer rulings are stored and applied on re-ask.
- Lets you add or retire a document live and see conflicts appear or disappear.
- Runs an evaluation on a tuning set and a separate held-out set.

## How it works
Rule-based and extractive. There is no generative AI in the prototype, so it cannot invent policy text. Answers are verbatim source sentences. A language model is planned, not built.

## Run it
Open `index.html` in a browser. It works offline with no server.

To rebuild after editing `src/`: `cd src && python build.py`.
To run the evaluation: `node src/test.js`.

## Evaluation (read before quoting any number)
- Held-out set: 18 of 20 expected outcomes, 1 confident-but-wrong case.
- Tuning set: 12 of 12, but thresholds were set on it, so it is optimistic.
- Both sets are small and synthetic. They illustrate the method and are not a benchmark.

## Limits
All documents are invented. Conflict detection compares numbers and simple allow/forbid wording, so subtle contradictions can be missed. Not tested with real users or real documents.

## Files
`index.html` demo, `src/` source and tests, `screenshots/` captures, `docs/TrustGate_Walkthrough.pdf` walkthrough.

## AI disclosure
AI tools were used to help write the code and documentation. The author reviewed the work and is responsible for it.
