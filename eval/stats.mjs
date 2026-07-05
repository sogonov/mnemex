// stats.mjs — significance for small-corpus retrieval evals. Zero deps.
//
// Two tools, both standard for IR eval at small n (Smucker et al., CIKM 2007):
//   - bootstrapCI: 95% confidence interval for a metric's mean.
//   - pairedPermutationTest: is arm A's per-query metric better than arm B's?
//     (paired — same queries scored under both arms.)
//
// Deterministic: a seeded PRNG (mulberry32) so a run is reproducible; pass a
// fixed `seed` to compare runs. Self-test: node eval/stats.mjs --selftest

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Bootstrap 95% CI for the mean of `values`. Returns {mean, lo, hi}. */
export function bootstrapCI(values, { resamples = 10000, alpha = 0.05, seed = 1 } = {}) {
  const v = values.filter((x) => x !== null && x !== undefined);
  const n = v.length;
  if (n === 0) return { mean: null, lo: null, hi: null, n: 0 };
  const rand = mulberry32(seed);
  const means = new Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += v[(rand() * n) | 0];
    means[r] = s / n;
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor((alpha / 2) * resamples)];
  const hi = means[Math.floor((1 - alpha / 2) * resamples)];
  return { mean: mean(v), lo, hi, n };
}

/**
 * Paired permutation (randomization) test, two-sided.
 * a, b: per-query metric arrays for the two arms (same order/queries).
 * H0: the two arms have the same mean. p = fraction of sign-flipped resamples
 * whose |mean diff| >= |observed|. Standard for TREC-style IR comparisons.
 */
export function pairedPermutationTest(a, b, { resamples = 10000, seed = 1 } = {}) {
  const diffs = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] == null || b[i] == null) continue;
    diffs.push(a[i] - b[i]);
  }
  const n = diffs.length;
  if (n === 0) return { observed: null, p: null, n: 0 };
  const observed = mean(diffs);
  const absObs = Math.abs(observed);
  const rand = mulberry32(seed);
  let ge = 0;
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += rand() < 0.5 ? -diffs[i] : diffs[i];
    if (Math.abs(s / n) >= absObs - 1e-12) ge++;
  }
  return { observed, p: (ge + 1) / (resamples + 1), n }; // +1 smoothing (never reports p=0)
}

// ---- self-test ----
function selftest() {
  let fail = 0;
  const near = (name, got, want, eps) => {
    const ok = Math.abs(got - want) < eps;
    if (!ok) { fail++; console.log(`  ✗ ${name}: got ${got}, want ~${want}`); }
    else console.log(`  ✓ ${name} = ${got.toFixed(4)}`);
  };
  // CI of a constant array is the constant, zero width.
  const ci0 = bootstrapCI([0.9, 0.9, 0.9, 0.9]);
  near("CI(const).mean", ci0.mean, 0.9, 1e-9);
  near("CI(const).width", ci0.hi - ci0.lo, 0, 1e-9);
  // CI brackets the mean and has positive width for varied data.
  const ci1 = bootstrapCI([0.2, 0.4, 0.6, 0.8, 1.0], { seed: 42 });
  near("CI(varied).mean", ci1.mean, 0.6, 1e-9);
  if (!(ci1.lo < ci1.mean && ci1.mean < ci1.hi)) { fail++; console.log("  ✗ CI does not bracket mean"); }
  else console.log(`  ✓ CI brackets mean: [${ci1.lo.toFixed(3)}, ${ci1.hi.toFixed(3)}]`);
  // Identical arms → p ≈ 1 (no difference).
  const same = pairedPermutationTest([0.5, 0.6, 0.7], [0.5, 0.6, 0.7]);
  if (!(same.p > 0.9)) { fail++; console.log(`  ✗ identical arms p: got ${same.p}, want >0.9`); }
  else console.log(`  ✓ identical arms p = ${same.p.toFixed(3)}`);
  // Large consistent gap → p small.
  const gap = pairedPermutationTest([0.9, 0.92, 0.88, 0.91, 0.9, 0.93, 0.89, 0.9],
                                    [0.2, 0.25, 0.18, 0.22, 0.2, 0.24, 0.19, 0.21], { seed: 7 });
  near("gap observed", gap.observed, 0.6925, 1e-3);
  if (!(gap.p < 0.05)) { fail++; console.log(`  ✗ clear gap p: got ${gap.p}, want <0.05`); }
  else console.log(`  ✓ clear gap p = ${gap.p.toFixed(4)}`);
  console.log(fail ? `\nFAIL (${fail})` : "\nstats.mjs OK");
  return fail;
}

if (process.argv.includes("--selftest")) process.exit(selftest() ? 1 : 0);
