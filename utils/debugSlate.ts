export function probeNames(slate: { home: string; away: string }[], needle = "alabama") {
  const hits = new Set<string>();
  const re = new RegExp(needle, "i");
  for (const g of slate) {
    if (re.test(g.home)) hits.add(g.home);
    if (re.test(g.away)) hits.add(g.away);
  }
  return Array.from(hits).sort().slice(0, 20);
}
