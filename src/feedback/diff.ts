// A word-by-word comparison of the old text and the suggested text, for the
// struck-through and underlined view, like suggesting in Google Docs.

export type Op = { t: "same" | "del" | "ins"; w: string };

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

// Longest common run of words, then a walk back through it. Texts here are a
// paragraph at most; past a few million cells it gives up and shows the whole
// text replaced, which is still right, only less tidy.
export function wordDiff(a: string, b: string): Op[] {
  const A = words(a), B = words(b);
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return [...A.map((w) => ({ t: "del" as const, w })), ...B.map((w) => ({ t: "ins" as const, w }))];
  const L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: "same", w: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ t: "del", w: A[i++] }); }
    else { out.push({ t: "ins", w: B[j++] }); }
  }
  while (i < n) out.push({ t: "del", w: A[i++] });
  while (j < m) out.push({ t: "ins", w: B[j++] });
  // Within each changed stretch, all the old words first and then the new,
  // so it reads as "old struck, new underlined" rather than interleaved.
  const tidy: Op[] = [];
  for (let k = 0; k < out.length;) {
    if (out[k].t === "same") { tidy.push(out[k++]); continue; }
    const del: Op[] = [], ins: Op[] = [];
    while (k < out.length && out[k].t !== "same") (out[k].t === "del" ? del : ins).push(out[k++]);
    tidy.push(...del, ...ins);
  }
  return tidy;
}

// Runs of the same kind joined into one string each, ready to draw.
export function diffRuns(a: string, b: string): Op[] {
  const runs: Op[] = [];
  for (const o of wordDiff(a, b)) {
    const last = runs[runs.length - 1];
    if (last && last.t === o.t) last.w += ` ${o.w}`;
    else runs.push({ ...o });
  }
  return runs;
}

export const sameText = (a: string, b: string) => words(a).join(" ") === words(b).join(" ");

// Only the part that changed, with a few words either side, for one line in
// the inbox and the review list: "can no longer get to" -> "can no longer
// reach". Leading and trailing "..." mark where the text was cut.
export function changeSpan(a: string, b: string, context = 3): { old: string; new: string } {
  const ops = wordDiff(a, b);
  const first = ops.findIndex((o) => o.t !== "same");
  if (first < 0) return { old: a.trim(), new: b.trim() };
  let last = ops.length - 1;
  while (ops[last].t === "same") last--;
  const from = Math.max(0, first - context), to = Math.min(ops.length - 1, last + context);
  const span = ops.slice(from, to + 1);
  const pre = from > 0 ? "..." : "", post = to < ops.length - 1 ? "..." : "";
  const side = (keep: "del" | "ins") => pre + span.filter((o) => o.t === "same" || o.t === keep).map((o) => o.w).join(" ") + post;
  return { old: side("del"), new: side("ins") };
}
