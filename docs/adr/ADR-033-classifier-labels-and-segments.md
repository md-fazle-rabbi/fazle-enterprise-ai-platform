# ADR-033: Classifier labels and segment scoring

Status: Accepted (2026-10-10)

## Context
The injection classifier compared the pipeline label to "INJECTION", a Prompt Guard 1 name.
Prompt Guard 2 is a binary classifier, so every malicious verdict was turned into a score
near zero, and the regex layer did all the blocking. A blatant injection logged
classifier_score 0.0005 in proof/web-chat-bff-red-team.txt. The model also has a 512 token
window, and Meta's model card says to split longer input into segments and scan each one.
The code scored each text in one call.

## Decision
1. Run the tokenizer and model directly and read the malicious probability from index 1 of
   the softmax, instead of interpreting a pipeline label.
2. Check the labels (index 0 benign, index 1 malicious) and the tokenizer template
   ([CLS] text [SEP]) once at load. The app refuses to start if either is different.
3. Split text into windows of 510 tokens with 64 tokens of overlap, score at most 64 of
   them in batches of 8, and take the highest probability.
4. Keep the thresholds (flag 0.60, block 0.95) and the call sites unchanged.

## Options considered
- Keep the pipeline and fix the label string: rejected. It depends on label names and on
  an output shape that changed between library versions. Index 1 plus a startup check
  does not.
- Truncate to 512 tokens (the old behaviour): rejected. An injection after the first 512
  tokens is never scored.
- Split by sentence: rejected. A sentence can exceed the window, and a short one gives the
  model too little context.
- Score every segment with no cap: rejected. One worker with no GPU would stall on a very
  long document.

## Consequences
Positive: the classifier layer works for the first time, long text is covered up to the cap,
and a wrong label order can no longer pass unnoticed.
Negative: false positives are now possible, because the layer is live. Long retrieved
sections cost more at query time, and the lethal trifecta check now sees real scores.
Risks and mitigations:
- Thresholds have only been checked against the golden set and six fixed cases.
  Mitigation: evals/classifier_check.py reports them, and the README states the gap.
- Text after about 28,000 tokens is covered by the regex layer only. Mitigation: the cap is
  pinned by a test and stated in the README. Upload limits come in the next step.
- The recorded p95 latency predates this change. Mitigation: re-measure with the load test.

## Addendum 2026-10-10: stored content and the flag line

### Context

A live red-team test posted a 400-sentence benign document with a two-sentence
injection at the end to `/ingest`. It was stored (HTTP 201). The classifier scored it
0.8775, which is a flag (0.60 up to 0.95), and a flag was only logged. The same
injection alone scored 0.9776. With five benign sentences before it the score was
already 0.8857. Shrinking the scoring window did not help: 512, 256 and 128 token
windows gave 0.8775, 0.8791 and 0.8392 on the long document.

### Decision

For text that is stored, a flag is treated as a block (`blocks_stored_content` in
`security/firewall.py`). This applies to `/ingest` through the middleware and to the
text extracted from images and PDF pages. Questions keep the old rule: only a block
refuses them.

### Consequences

- The observed case is refused. Alignment: OWASP LLM01:2025 (indirect prompt
  injection through stored documents). This is risk reduction, not elimination.
- A legitimate document that scores 0.60 or more is refused. The repo's own documents
  were scored in `proof/classifier-benign-docs.txt`.
- An injection that scores below 0.60 inside a long benign text was not tested and may
  still be stored.
- Scoring at sentence or paragraph level, in addition to windows, is planned and not
  implemented.
