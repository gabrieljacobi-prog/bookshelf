# Bookshelf

A home-library catalogue for two, replacing a bookshelf app. Static site on GitHub Pages, Firebase (Auth + Firestore) behind it.

## Current state

- `/` — the app: library grid, book page, person pages, shelves and filters, Add book, the Errata list (things to fix). On screens 1024 px and wider: a side rail, a wider grid, the filter as a side panel and a two-column book page. `js/data.js` (Firebase, with Firestore's local cache), `js/app.js` (views), `css/app.css` (tokens and type). Anyone can browse; signed-in members also see and change read status and loans.

## Code

- `js/names.js` — name and title helpers (`slug`, `sortName`, `fixName`, `splitTitle`, `fold`). No DOM, testable in Node.
- `js/checks.js` — catalogue checks: odd records, near-duplicate people and publishers.
- `js/lookup.js`, `js/editions.js`, `js/covers.js`, `js/crop.js`, `js/scanner.js` — metadata lookup, edition search, covers, cropping, barcode scanning.
- `js/wikidata.js`, `js/nations.js` — author lookup and nationality cleaning.

No build step: plain HTML and ES modules. `vendor/zxing-browser.min.js` is @zxing/browser 0.2.1. The one-off import of the previous app's CSV export (`import/`, `js/import-clean.js`) was removed on 3 Nov 2026; it is in git history.
