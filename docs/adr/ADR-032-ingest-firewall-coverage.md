# ADR-032: Injection firewall coverage for image and PDF uploads

Status: Accepted (2026-10-10)

## Context
The firewall middleware reads JSON bodies on three exact paths. Image and PDF uploads are
multipart, so the middleware never sees them. Each upload handler runs assess() on the
extracted text, but nothing tested that: the test conftest faked the firewall only inside
the middleware, and the PDF route had no test at all. Reading the PDF route also showed
that it left out pii_analyzer_version (NOT NULL, no default), dropped blocked pages
without telling the caller, and could leave an empty document behind.

## Decision
1. The check stays inside the handlers, on the extracted text. A multipart body has no
   text field to scan before extraction, and the extracted text is what reaches the index
   and the model.
2. A PDF is rejected whole if any page is blocked. A page with no readable content is
   skipped and listed in skipped_pages. A PDF with no readable page is a 422.
3. Every page is read and checked before anything is embedded or written. One batched
   embedding call follows.
4. New tests run the real assess() and fake only the Hugging Face classifier score.

## Options considered
- Scan the raw upload in the middleware: rejected. There is no text to scan before the
  vision model has read the file.
- Keep clean pages and drop blocked ones (the old behaviour): rejected. A page that
  carries an injection shows attacker intent, the rest of the file has no better claim to
  be trusted, and a quiet drop tells nobody.
- Store the document first and delete it on a block: rejected. It spends embedding calls
  on a file that is then thrown away.
- Fake assess() entirely in the new tests: rejected. That would only show the handler
  calls a function, not that an injected page is blocked.

## Consequences
Positive: a hostile page costs no embedding calls and leaves no rows. The caller learns
which page was blocked and which were skipped. The route can now store a PDF at all.
Negative: one false positive page rejects the whole file. The caller sees the page number
and can fix the file and upload again.
Risks and mitigations:
- The unit tests prove the regex layer and the wiring, not the classifier. Mitigation:
  the curl proof runs the whole stack, classifier included.
- The classifier window is 512 tokens and text is scored in one call. Mitigation: scoring
  in segments is the next step, and the README states the gap until then.
