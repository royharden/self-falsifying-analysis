# Data contract

## CSV upload

- Size checked with `file.size` before reading: at most 1,048,576 bytes.
- UTF-8 only (invalid UTF-8 is rejected). The original-file hash is SHA-256 of the exact bytes, including any BOM. Only a leading UTF-8 BOM is stripped before parsing.
- RFC 4180 style: comma separator; CRLF, LF or CR line ends; quoted cells with `""` escapes; a quote inside an unquoted cell, text after a closing quote, or an unterminated quote is an error. Trailing blank lines are ignored; interior blank lines are ragged rows.
- First row is the header. 2–24 columns, 40–5000 data rows (a fit needs n ≥ 40).
- Cells: spaces/tabs around a value are ignored; the value must match `^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$` and be finite. Empty cells, text, `NaN`, `Infinity`, booleans and dates are rejected with row and column. `-0` is stored as `0`; zeros are values, not missing.
- No coercion, imputation, row dropping, deduplication or filtering. Row and column order are preserved.

## Header normalization

1. Trim outer whitespace.
2. Replace each run of characters outside `[A-Za-z0-9_]` with one `_`.
3. Strip leading and trailing `_`; an empty result is rejected.
4. Prefix `col_` if the first character is not a letter.
5. Reject results longer than 41 characters. The final identifier matches `^[A-Za-z][A-Za-z0-9_]{0,40}$`.

Comparison is case-sensitive. Two headers that normalize to the same identifier are rejected (never suffixed). The source-to-identifier map is shown before freezing and kept in the dataset provenance.

## Normalized table identity

`normalizedHash = SHA-256(canonicalJson({columns, rows}))`, where canonical JSON sorts object keys, keeps array order, writes `-0` as `0` and uses ECMAScript number formatting. The server stores this exact text and re-hashes it.

## Fixtures

Generated tables bind `generatorVersion`, `seed`, `parameters` and `fixtureId` instead of an original-file hash. Workshop fixtures: n = 200, `hours = 5 + 2z + u`, `prior_score = 50 + 10z`, `final_score = 70 + β·hours + 4z + e`, plus an unrelated decoy and a post-exposure column; values rounded to 3 decimals; β = 0 (seed 19019) or 1 (seed 19020); suggested δ = 0.5 points/hour.

## Exports

- `run.json`: `BundleV1` — table, protocol and hash, every execution with terminal records and observed events, and a `derived` block (headline code and facts hash) that readers recompute and compare.
- `events.jsonl`: one locally observed transition per line, in recorded order; not an independent chronology.

## Planner request (metadata only)

`{requestId, catalogueVersion, claim:{statement, x, y, direction, delta, units}, columns:[{id, label, type:"numeric", userRole?, timeRelation?}], rowCount}` — ≤ 16 KiB, unknown fields rejected, no values or statistics.
