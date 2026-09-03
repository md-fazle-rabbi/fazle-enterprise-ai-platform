# ADR-005: multimodal ingestion architecture

## Status
Accepted

## Context
Client documents are often scanned contracts, screenshots, and charts,
not clean text. These need to become searchable and citable the same way
text does, without a separate, less-scrutinized path that's both an
easier injection target and harder to keep secure over time.

## Decision
- Vision-capable Gemini call first for any image or PDF page, OCR
  (Tesseract) as fallback only.
- PDF pages render to images via PyMuPDF, targeting scanned/image-embedded
  PDFs specifically, not born-digital text PDFs (separate, simpler,
  not built yet).
- Extracted content flows through the same Chunk table, embedding
  pipeline, citation-checking, and injection firewall as text ingestion.
  A modality column records provenance, it doesn't branch behavior.

## Options considered
- Separate ImageChunk/PdfChunk tables with their own retrieval and
  citation logic: rejected, doubles the surface area needing security
  review and creates exactly the kind of "less important" path that gets
  forgotten later.
- OCR as primary, vision as enhancement: rejected, OCR loses chart/table
  structure and anything that isn't literally text-shaped.

## Consequences
Positive: one citation and firewall implementation to audit, not one per
modality.
Negative: every image or PDF page costs a full vision-model call before
the cheaper OCR fallback, real per-document cost worth tracking once
volume is real (cost/query dashboard).
Risk to mitigation: sequential page processing is slow on long PDFs,
concurrent processing is documented future scope, not built now.