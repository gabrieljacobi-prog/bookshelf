# Bookshelf

A home-library catalogue for two, replacing the Bookshelf app. Static site on GitHub Pages, Firebase (Auth + Firestore) behind it.

## Current state: scanner prototype

- `scan/` — camera barcode scanner (ZXing in Firefox, the built-in detector in Chrome) with lookups in Google Books, Open Library and LIBRIS.
- `test/` — coverage test: runs every ISBN from the old Bookshelf export through the same lookups and reports hit rates and missing covers.

No build step: plain HTML and ES modules. `vendor/zxing-browser.min.js` is @zxing/browser 0.2.1.
