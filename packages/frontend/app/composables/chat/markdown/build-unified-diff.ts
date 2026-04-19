/**
 * Minimal unified-diff builder using an LCS table. Intended for short
 * old/new pairs (Edit tool). Not optimized for very large inputs — if that
 * becomes a bottleneck, swap in `diff` from npm.
 */
export function buildUnifiedDiff(oldStr: string, newStr: string, filename: string): string {
  const a = oldStr.split('\n')
  const b = newStr.split('\n')
  const n = a.length
  const m = b.length

  // LCS length table
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const lines: string[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push(' ' + a[i]); i++; j++ }
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) { lines.push('-' + a[i]); i++ }
    else { lines.push('+' + b[j]); j++ }
  }
  while (i < n) { lines.push('-' + a[i]); i++ }
  while (j < m) { lines.push('+' + b[j]); j++ }

  const header = `--- a/${filename}\n+++ b/${filename}`
  const hunk = lines.length ? `@@ -1,${n} +1,${m} @@\n${lines.join('\n')}` : ''
  return hunk ? `${header}\n${hunk}` : header
}
