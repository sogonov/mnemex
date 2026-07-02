// metrics.mjs — ranked-retrieval metrics for the mnemex eval. Zero deps, pure functions.
//
// All take a `ranked` array of doc ids (best-first) and a `relevant` Set of ids.
// Binary relevance (a doc is relevant or not) — enough for the fixture, and the
// standard setting for Recall@k / MRR / MAP. nDCG uses binary gains too.
//
// Self-test:  node eval/metrics.mjs --selftest

const log2 = (x) => Math.log(x) / Math.log(2);

/** Fraction of relevant docs found in the top-k. */
export function recallAtK(ranked, relevant, k) {
  if (relevant.size === 0) return null; // undefined for no-answer queries — handle separately
  let hits = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) if (relevant.has(ranked[i])) hits++;
  return hits / relevant.size;
}

/** 1 / rank of the first relevant doc (0 if none in the list). */
export function reciprocalRank(ranked, relevant) {
  for (let i = 0; i < ranked.length; i++) if (relevant.has(ranked[i])) return 1 / (i + 1);
  return 0;
}

/** Average Precision: mean of precision@rank at each relevant hit, over |relevant|. */
export function averagePrecision(ranked, relevant) {
  if (relevant.size === 0) return null;
  let hits = 0, sum = 0;
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i])) {
      hits++;
      sum += hits / (i + 1);
    }
  }
  return sum / relevant.size;
}

/** nDCG@k with binary gains. DCG@k / IDCG@k. */
export function ndcgAtK(ranked, relevant, k) {
  if (relevant.size === 0) return null;
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) {
    if (relevant.has(ranked[i])) dcg += 1 / log2(i + 2); // gain=1, discount log2(rank+1)
  }
  // Ideal: all relevant docs packed at the top (capped at k).
  const ideal = Math.min(relevant.size, k);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** Mean of a numeric array, ignoring null (unscored). */
export function mean(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Compute the standard metric bundle for one query. */
export function scoreQuery(ranked, relevant, { k = 10 } = {}) {
  return {
    ndcg: ndcgAtK(ranked, relevant, k),
    recall_at_5: recallAtK(ranked, relevant, 5),
    recall_at_10: recallAtK(ranked, relevant, 10),
    mrr: reciprocalRank(ranked, relevant),
    ap: averagePrecision(ranked, relevant),
  };
}

// ---- self-test ----
function approx(a, b, eps = 1e-6) { return a !== null && Math.abs(a - b) < eps; }
function selftest() {
  let fail = 0;
  const check = (name, got, want) => {
    const ok = approx(got, want);
    if (!ok) { fail++; console.log(`  ✗ ${name}: got ${got}, want ${want}`); }
    else console.log(`  ✓ ${name} = ${got.toFixed ? got.toFixed(4) : got}`);
  };
  // ranked A,B,C,D ; relevant {B,D} (ranks 2 and 4)
  const ranked = ["A", "B", "C", "D"], rel = new Set(["B", "D"]);
  check("recall@2", recallAtK(ranked, rel, 2), 0.5);
  check("recall@4", recallAtK(ranked, rel, 4), 1.0);
  check("mrr", reciprocalRank(ranked, rel), 0.5);
  check("ap", averagePrecision(ranked, rel), 0.5); // (1/2 + 2/4)/2
  // nDCG@4: DCG=1/log2(3)+1/log2(5); IDCG=1/log2(2)+1/log2(3)
  const dcg = 1 / log2(3) + 1 / log2(5), idcg = 1 / log2(2) + 1 / log2(3);
  check("ndcg@4", ndcgAtK(ranked, rel, 4), dcg / idcg);
  // perfect ranking → nDCG 1
  check("ndcg@4 perfect", ndcgAtK(["B", "D", "A", "C"], rel, 4), 1.0);
  // no relevant found
  check("mrr miss", reciprocalRank(["A", "C"], rel), 0);
  // no-answer query returns null (not 0) for set-based metrics
  const empty = recallAtK(["A"], new Set(), 5);
  if (empty !== null) { fail++; console.log(`  ✗ empty recall: got ${empty}, want null`); }
  else console.log("  ✓ empty-relevant recall = null");
  console.log(fail ? `\nFAIL (${fail})` : "\nmetrics.mjs OK");
  return fail;
}

if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);
