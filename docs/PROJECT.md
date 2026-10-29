# Bookshelf: project summary

Status as of 29 Oct 2026. Home-library catalogue for Gabriel (Flor) and Ingrid, replacing the Bookshelf app.

## Decisions

**Users and access**
- Two users, equal rights: Flor = gabriel.jacobi@gmail.com, Ingrid = ingrid.skare@gmail.com. Google sign-in.
- Friends browse a public read-only view without an account. They see the books only, not who read what, not loans.
- "Currently lent to…" note on a book (one existing loan: The Rings of Saturn → Kelvin).

**Platform**
- Web app (PWA), no native app. Both users are on Android; the main browser is **Firefox** (no native BarcodeDetector, so ZXing is used).
- Plain HTML + ES modules, no build step. Hosted on GitHub Pages: repo `gabrieljacobi-prog/bookshelf`, served at **https://gabrieljacobi.com/bookshelf/** (custom domain).
- Firebase project `bookshelf-55c34`. Firestore in Standard edition, production mode. Auth with Google provider. Authorised domains: gabrieljacobi.com, bookshelf-55c34.firebaseapp.com.
- Cover photos are stored in Firestore as compressed base64 (`covers` collection, field `image`, under 900 KB), not in Cloud Storage, so no Blaze plan is needed. Users can take a photo or upload one.
- Interface in English.

**Data per book**
- Title, author(s), cover, publisher, language, category (Ficção / Não Ficção / Quadrinhos / Referências from the old app), series + volume, format (physical / ebook).
- The ISBN is optional; the edition is what matters. Fields for publisher, year and an edition note ("Zephyr Books", "book club edition").
- Per-person read status (replaces the "Read (Flor)" / "Read (Ingrid)" tags).
- Author records hold nationality and gender, from Wikidata, editable and marked as checked. Comics distinguish writer and artist; translators are kept.
- Languages: mostly English, then Portuguese, Swedish, Dutch, plus some Japanese. Ask Gabriel when a language is unknown ("un").
- Kobo / Google Play ebooks: postponed; add manually later as format = ebook.

**Firestore layout** (rules in `firestore.rules`, published in the console)
- `books`, `authors`, `series`, `covers`: public read; members write.
- `private/{bookId}`: readBy, lentTo, notes. Members only. Firestore can't hide fields within a document, hence the separate collection.

## Metadata lookup: tested on real books

Order (in `js/lookup.js`):
1. **Open Library** + **LIBRIS**, in parallel, and **BrasilAPI** for Brazilian ISBNs (978-85 / 978-65).
2. **Google Books** only when those miss the book *or* have no cover that loads. Its ISBN search is inconsistent; it tries both `isbn:` and a plain query, and backs off on 503/429. It uses the Firebase browser key (Books API enabled on the key, restricted to the two domains).
3. Covers are kept only if the image actually loads.
4. Whatever is left: the user's own photo plus a quick form.

Coverage test across all 408 ISBNs from the export: **99% found, 81% with a working cover.**
- 6 not found: Sable: Design Works, Savage Sword of Conan vol. 2, Intermezzo, Metal Hurlant (979-8, Humanoids; no ISBN barcode on the book), The Chrysalids, plus `9785516079177` (probably a misread).
- 72 found without a cover: about half Brazilian (BrasilAPI knows them but often has no image), the rest older or book-club editions.
- **Open question:** check that LIBRIS covers (xinfo.libris.kb.se image service) are real covers and not a generic placeholder. Test with 9789187875366 and 9789177016335.

## Scanner (works in Firefox on Android)

- Own frame loop: each frame is cropped to the guide area and decoded with ZXing (`vendor/zxing-browser.min.js`, @zxing/browser 0.2.1). Chrome's native detector is used when available.
- A code is accepted after two identical reads. EAN-13 and UPC-A are read; a non-ISBN code (a price barcode) shows "look inside the front cover". Older US paperbacks (e.g. Cordelia's Honor) keep the ISBN barcode inside the front cover.
- **Take photo** fallback decodes a still taken with the phone's camera (tries bands and rotation).
- Typed ISBN entry. Pages: `/scan/` (scanner test), `/test/` (coverage test).

## Findings about the old data (Bookshelf CSV export, 409 books)

- Only 1 book has no ISBN in the export (The Star Fox), but **many records point to the wrong edition**. When a scan failed, the closest match was chosen. Examples: Dr Jekyll & Mr Hyde (actually a Zephyr Books edition, not Modernista 2017), Watership Down and both Chronicles of Amber volumes (book-club editions). Gabriel spots these by the cover not matching.
- Clean-up needed on import: trailing spaces in categories; messy language codes (en/pt/pt br/br/sv/nl/un/blank); garbled author names ("Wyndham. John", "Jr. James Tiptree", "Ana Paula author. Maia", "… pseud. för …"); series inside titles ("(The Book of the New Sun, #4)"); placeholder dates "1970-01-01".

## Verification flow (agreed)

- Every imported book starts **unverified**.
- Check by eye, not by scanning (scanning was judged too slow). A **wall of covers** grouped like the shelves; tap only the wrong ones, then **Done** marks the rest verified.
- Flagged books become a fix list: search other editions (Open Library / LIBRIS edition lists), scan the barcode, or take a cover photo.

## Next steps

1. Design mockups to react to: library grid, book page, scan/add flow, cover-wall verification, public friends' view. Gabriel is a designer and wants a proposal to tweak.
2. Import the 409 books into Firestore with the clean-up above; reading status and the loan carried over; all marked unverified.
3. Build in order: library + book pages with sign-in → cover-wall verification and edition fixing → adding books (scan / photo / manual, including no-ISBN books) → authors via Wikidata → public read-only link.
