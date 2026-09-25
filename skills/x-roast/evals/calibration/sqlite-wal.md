# Can one SQLite file serve our API's reads while the importer writes?

## Question
The importer writes about 50 rows a second into `catalog.db` while the API reads from the same
file. Readers currently see `SQLITE_BUSY` a few times an hour. Does WAL mode remove that, and what
does it cost?

## Sources
- SQLite, "Write-Ahead Logging" (https://www.sqlite.org/wal.html): in WAL mode "readers do not
  block writers and a writer does not block readers", there is still one writer at a time, and all
  processes must be on the same host (WAL does not work over a network filesystem).
- SQLite, "PRAGMA busy_timeout" (https://www.sqlite.org/pragma.html#pragma_busy_timeout).

## Method
`bench/wal.mjs` (in this repo) runs one writer at 50 rows/s and 8 readers doing the API's three
hottest queries for 10 minutes, once with `journal_mode=DELETE` and once with `journal_mode=WAL`,
each with `busy_timeout=0` so every contention is counted. Run it with `node bench/wal.mjs --mode
wal` on the API host (NVMe, local disk). Three runs per mode.

## Results
| Mode | SQLITE_BUSY on reads (per run) | p99 read latency |
|------|-------------------------------|------------------|
| DELETE | 41, 37, 45 | 38 ms |
| WAL | 0, 0, 0 | 4 ms |

## Limits
- One writer still: a second importer would contend with the first. Not measured.
- The WAL file grows between checkpoints; with the default auto-checkpoint it stayed under 8 MB here.
- The file must stay on local disk; the API's NFS staging copy cannot use WAL.

## Conclusion
Switch `catalog.db` to WAL and set `busy_timeout=2000` for the importer. Revisit if a second writer
is added.
