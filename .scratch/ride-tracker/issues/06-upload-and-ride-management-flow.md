# Upload & ride-management flow

Type: grilling
Status: resolved
Blocked by: 02

## Question

What is the upload experience, and what management does a ride need after upload?

Decide with Carsten, within the architecture chosen in the Cloudflare research:

- Upload UX: drag-drop / file picker page, phone-friendly; multiple files at once?
- Feedback: parse + stats computed on upload — what does the success screen show?
- Duplicate handling: re-uploading the same GPX (detect by hash/time-range?).
- Editing: rename a ride, delete a ride, correct ride type?
- Backfill: importing the existing `airport.gpx` and any Komoot back-catalog.

## Answer

Resolved 2026-07-16 via grilling with Carsten. All locked.

### Upload UX

- **Dedicated `/upload` page**, linked from an Upload button in the dashboard header. One big drop zone that is also a tap-to-open-file-picker target (`<input type="file" multiple accept=".gpx">`), so the phone flow is tap → pick → done. The landing page stays read-only; no drop-anywhere there.
- **Multi-file**: the client parses each file sequentially and POSTs one ride at a time (raw GPX → R2 + derived JSON → D1, per the architecture ticket — the Worker contract stays single-ride).
- **Auto-save, no review step**: dropping files saves them immediately. Rationale: single trusted user, data always from Komoot, mistakes are reversible (delete / overwrite-on-re-upload), so a confirm gate would tax every upload to prevent a recoverable error.

### Results screen

A per-file result list; each ride gets a card reusing the library-card rendering:

- Name, date, and **outcome**: `saved`, `overwritten <existing ride>`, or `failed: <reason>` (failed files block nothing — the rest still save).
- Key stats (distance, moving time, avg moving speed, elevation gain) + the SVG route thumbnail, all computed client-side during the upload anyway.
- **Records-broken trophy callout** (the ephemeral mechanism locked in the library/dashboard ticket).
- Click-through to the ride detail page.

### Duplicate handling — start timestamp is the duplicate key

The ID (date+name-slug) is *not* the dedupe key; the **first-trackpoint timestamp** is (exact match — Komoot re-exports are byte-identical on timestamps). On upload:

1. **A ride with the same start time exists** → same ride: **replace it**, even if the name changed (old D1 rows + R2 object removed, saved under the new ID). This is what makes "retitle by renaming in Komoot and re-uploading" actually work — and likewise fixes a wrong `sport` type. Result card reports "overwritten".
2. **No start-time match but the ID is taken** → genuinely different ride, same day + name → **`-2` suffix** (as locked in the stats ticket).
3. **Neither** → new ride.

No content hashing — one rider's start-second is unique in practice and survives re-exports.

### Ride management — delete only

- **Delete is the only in-app operation**: a "Delete ride" action on the ride **detail page only** (not on library cards), behind a plain confirm dialog. The Worker removes the D1 rows and the R2 object; records, totals, and heatmap need no cleanup because they're derived from the index at read time — the next-best ride inherits any records automatically.
- **No rename UI, no sport-type editor**: all metadata corrections happen upstream in Komoot + re-upload (the start-time key replaces the old ride).

### Backfill — not a feature

Backfill is just the first use of the upload page: download the Komoot back-catalog manually (per-ride GPX export is a human task outside the app), drop everything on `/upload` in one go. Upload order doesn't matter — records/totals are recomputed from the index, not accumulated. `airport.gpx` is simply one of the files. Known cosmetic quirk, accepted: during bulk backfill the records-broken callouts are noisy (the first ride breaks all 8); harmless because the callout is ephemeral by design.
