# Test fixtures

## `mercuryStationsHorizons.json`

Mercury's stations from 2020 to 2035, 101 of them, as reference values for
`src/components/astrology/mercuryRetrograde.test.ts`. Each entry has the
station's `type` (`R` where Mercury turns retrograde, `D` where it turns
direct), the `date` it happens (UTC) and the apparent ecliptic longitude
`lon` it turns at, in degrees.

They come from NASA JPL Horizons, whose DE441 ephemeris is the reference our
own ephemeris is measured against. Horizons results are US government work
and in the public domain.

Regenerate or extend with:

```bash
node scripts/horizons-stations.mjs 2020 2035
```

That script explains how it asks Horizons for the longitudes and fits the
stations. It needs network access, and the differences it produces between
runs are under a second.

## `db/`

Where `scripts/dump-test-tables.ts` writes the database table dumps that
`tests/memory-pglite.ts` loads. The dumps are generated, not committed.
