# ADR 006: Align lethal-trifecta "untrusted content exposure" to the firewall's FLAG_THRESHOLD

## Status
Accepted

## Context
`assess_trifecta()` combines three conditions (private data access,
untrusted content exposure, exfiltration channel) into a single
"lethal trifecta" trigger, firing when 2 of 3 are true and paging the
team via Slack.

The original implementation set:

```python
untrusted_content_exposure = max_classifier_score_on_context > 0.0
```

The injection-firewall classifier (`rag_engine.security.firewall`)
almost never returns an exact `0.0` in production — background noise
in the score is typical. Combined with `private_data_access` being
true on essentially every cited RAG answer, `> 0.0` meant the trifecta
detector triggered on a large fraction of ordinary, non-malicious
queries: 2-of-3 conditions were satisfied by default, and only the
presence of a URL in the answer varied in practice.

This defeats the purpose of a 3-factor escalation signal: it collapses
into a 1-factor detector ("does the answer contain a URL") while still
being reported as a stronger multi-condition signal, and produces
Slack alert volume high enough to train the on-call rotation to ignore
the channel.

## Decision
Replace the bare `> 0.0` check with a configurable
`exposure_threshold`, defaulting to the firewall's own
`FLAG_THRESHOLD` (0.60):

```python
untrusted_content_exposure = max_classifier_score_on_context >= exposure_threshold
```

Rationale for reusing `FLAG_THRESHOLD` specifically, rather than a new
independent constant:

- The firewall already encodes the organization's calibrated
  definition of "suspicious enough to act on." Introducing a second,
  separately-tuned threshold for the same underlying classifier score
  risks the two detectors silently disagreeing after a future tuning
  pass touches one and not the other.
- `exposure_threshold` is still an explicit parameter (not hardcoded
  inline), so a call site can override it with a documented reason —
  e.g., a stricter internal-only deployment — without editing this
  module.

## Consequences
- Alert volume for `lethal_trifecta` drops to cases where the context
  actually crossed the firewall's own suspicion bar, restoring the
  signal's intended selectivity.
- `assess_trifecta` gains an explicit `exposure_threshold` parameter
  and validates it to `[0, 1]`, failing fast on misconfiguration
  instead of silently comparing against a nonsensical value.
- A regression test (`test_default_threshold_matches_firewall_flag_threshold`)
  locks in the alignment invariant so a future edit to `FLAG_THRESHOLD`
  is forced to consider this module too.
- Lowering `exposure_threshold` below `FLAG_THRESHOLD` at a call site
  is legal but re-introduces looser triggering; any such override
  should cite a reason in its own commit/PR, not be a silent default
  change.

## Alternatives considered
- **Keep `> 0.0`, reduce alert volume by raising the `conditions_met`
  bar to 3.** Rejected: this would mask the real problem (the
  condition itself is nearly always true) rather than fixing the
  condition's definition, and would make the detector require an
  exfiltration URL *and* citations *and* any nonzero score — i.e. it
  would just become "citations + URL," identical in practice to the
  2-of-3 case today but without ever surfacing borderline-but-real
  untrusted-content cases where no URL is present yet.
- **New independent constant, e.g. `TRIFECTA_EXPOSURE_THRESHOLD = 0.6`
  duplicated locally.** Rejected: duplicating the value invites drift
  between the firewall and the trifecta detector over time.