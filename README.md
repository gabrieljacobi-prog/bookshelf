# Bookshelf

A home-library catalogue for two, replacing the Bookshelf app. Static site on GitHub Pages, Firebase (Auth + Firestore) behind it.

## Current state

- `/` — the app: library grid and book page, built from the "Bookshelf mockups" canvas. `js/data.js` (Firebase, with Firestore's local cache), `js/app.js` (views), `css/app.css` (tokens and type). Anyone can browse; signed-in members also see and change read status and loans.

## Tools

- `scan/` — camera barcode scanner (ZXing in Firefox, the built-in detector in Chrome) with lookups in Google Books, Open Library and LIBRIS.
- `import/` — one-off import of the Bookshelf CSV export: sign in, pick the CSV, review the clean-up, try covers, import. Clean-up rules live in `js/import-clean.js` (no DOM, testable in Node). Re-running skips books already imported; people and series that already exist are never overwritten.
- `test/` — coverage test: runs every ISBN from the old Bookshelf export through the same lookups and reports hit rates and missing covers.

No build step: plain HTML and ES modules. `vendor/zxing-browser.min.js` is @zxing/browser 0.2.1.
