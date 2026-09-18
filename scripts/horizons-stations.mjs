/**
 * Writes tests/fixtures/mercuryStationsHorizons.json, the reference Mercury
 * stations that mercuryRetrograde.test.ts checks our own ephemeris against.
 *
 * Run with `node scripts/horizons-stations.mjs [fromYear] [toYear]`. It asks
 * NASA JPL Horizons (DE441) for quantity 31, the observer-centred
 * ecliptic-of-date longitude of the apparent position, one hourly table per
 * year, and fits a cubic around each hourly extremum of that longitude.
 * Horizons results are US government work and in the public domain.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each year's table is a megabyte, so keep them out of the repo.
const CACHE = new URL(`file://${join(tmpdir(), "magickli-horizons/")}`);
mkdirSync(CACHE, { recursive: true });

async function fetchYear(year) {
  const file = new URL(`${year}.txt`, CACHE);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const params = new URLSearchParams({
    format: "text",
    COMMAND: "'199'",
    CENTER: "'500@399'",
    EPHEM_TYPE: "'OBSERVER'",
    // One day of overlap on each side so stations at year ends are found.
    START_TIME: `'${year - 1}-12-31'`,
    STOP_TIME: `'${year + 1}-01-02'`,
    STEP_SIZE: "'1h'",
    QUANTITIES: "'31'",
    EXTRA_PREC: "'YES'",
    CSV_FORMAT: "'YES'",
  });
  const res = await fetch(
    `https://ssd.jpl.nasa.gov/api/horizons.api?${params}`,
  );
  if (!res.ok) throw new Error(`Horizons ${year}: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("$$SOE")) throw new Error(`Horizons ${year}: ${text}`);
  writeFileSync(file, text);
  return text;
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

function parse(text) {
  const body = text.split("$$SOE")[1].split("$$EOE")[0];
  const rows = [];
  for (const line of body.trim().split("\n")) {
    const [date, , , lon] = line.split(",").map((s) => s.trim());
    const [, y, mon, d, hh, mm] = date.match(/(\d+)-(\w+)-(\d+) (\d+):(\d+)/);
    const ms = Date.UTC(+y, MONTHS.indexOf(mon), +d, +hh, +mm);
    rows.push({ ms, lon: +lon });
  }
  return rows;
}

/** Least-squares cubic through (x, y); returns [a, b, c, d]. */
function cubicFit(xs, ys) {
  const n = 4;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let k = 0; k < xs.length; k++) {
    const p = [1, xs[k], xs[k] ** 2, xs[k] ** 3];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += p[i] * p[j];
      A[i][n] += p[i] * ys[k];
    }
  }
  for (let i = 0; i < n; i++) {
    let max = i;
    for (let r = i + 1; r < n; r++)
      if (Math.abs(A[r][i]) > Math.abs(A[max][i])) max = r;
    [A[i], A[max]] = [A[max], A[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i] / A[i][i];
      for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

export async function horizonsStations(fromYear, toYear) {
  const all = new Map();
  for (let y = fromYear; y <= toYear; y++) {
    for (const r of parse(await fetchYear(y))) all.set(r.ms, r.lon);
  }
  const rows = [...all].sort((a, b) => a[0] - b[0]);
  // Unwrap longitude.
  const lon = [];
  let off = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i && rows[i][1] - rows[i - 1][1] < -180) off += 360;
    if (i && rows[i][1] - rows[i - 1][1] > 180) off -= 360;
    lon.push(rows[i][1] + off);
  }
  const out = [];
  const W = 6; // hours each side
  for (let i = W; i < rows.length - W; i++) {
    const isMax = lon[i] > lon[i - 1] && lon[i] >= lon[i + 1];
    const isMin = lon[i] < lon[i - 1] && lon[i] <= lon[i + 1];
    if (!isMax && !isMin) continue;
    const xs = [];
    const ys = [];
    for (let k = -W; k <= W; k++) {
      xs.push(k); // hours
      ys.push(lon[i + k] - lon[i]);
    }
    const [, b, c, d] = cubicFit(xs, ys);
    // b + 2c x + 3d x^2 = 0, root nearest 0
    const disc = Math.sqrt(4 * c * c - 12 * d * b);
    const roots = [(-2 * c + disc) / (6 * d), (-2 * c - disc) / (6 * d)];
    const x = roots.reduce((p, q) => (Math.abs(q) < Math.abs(p) ? q : p));
    if (Math.abs(x) > 1) throw new Error(`bad fit at ${new Date(rows[i][0])}`);
    out.push({
      type: isMax ? "R" : "D",
      date: new Date(rows[i][0] + x * 3600_000),
      lon: (((lon[i] + b * x + c * x * x + d * x ** 3) % 360) + 360) % 360,
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const from = Number(process.argv[2] ?? 2020);
  const to = Number(process.argv[3] ?? 2035);
  const stations = await horizonsStations(from, to);
  const file = new URL(
    "../tests/fixtures/mercuryStationsHorizons.json",
    import.meta.url,
  );
  writeFileSync(file, `${JSON.stringify(stations, null, 2)}\n`);
  console.log(`${stations.length} stations, ${from} to ${to}, in ${file}`);
}
