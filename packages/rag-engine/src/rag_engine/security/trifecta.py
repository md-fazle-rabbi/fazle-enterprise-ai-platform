"""
Lethal Trifecta detector.

Flags when private-data access, exposure to untrusted content, and an
exfiltration channel are simultaneously present in one response. This
is Simon Willison's "lethal trifecta" framing applied to a RAG answer:
any two of the three conditions being true is what makes prompt
injection *dangerous* rather than merely detected-and-ignored.

Design note (see docs/adr/ADR-006-trifecta-threshold.md for the full
writeup): `private_data_access` (has_citations) is close to
baseline-true for any RAG answer that actually cites sources, and is
intentionally cheap to satisfy — it's a precondition, not a signal.
`exfiltration_channel` (a model-generated URL) is the actually
variable, actionable signal. `untrusted_content_exposure` sits in
between: it must reflect content the injection classifier itself
considers suspicious, not merely non-zero, or it collapses into
baseline-true too and the detector degrades into "did the answer
contain a URL" while still being reported as a 3-factor signal.

That's why the classifier comparison here reuses FLAG_THRESHOLD from
the firewall module rather than a local magic number: the trifecta
detector and the firewall must agree on what "suspicious" means, or
an operator tuning one silently desyncs the other.
"""

import re
from dataclasses import dataclass

from rag_engine.security.firewall import FLAG_THRESHOLD

_URL_RE = re.compile(r"https?://[^\s)\]]+")

# Default classifier-score floor for counting context as "untrusted
# content exposure." Deliberately reuses the firewall's own FLAG
# threshold (see module docstring) instead of a bare > 0.0 check, so
# a chunk has to be something the firewall itself would flag before
# it counts toward the trifecta, not just any non-zero score.
DEFAULT_EXPOSURE_THRESHOLD = FLAG_THRESHOLD


@dataclass(frozen=True)
class TrifectaAssessment:
    private_data_access: bool
    untrusted_content_exposure: bool
    exfiltration_channel: bool
    exposure_threshold: float

    @property
    def conditions_met(self) -> int:
        return sum(
            [
                self.private_data_access,
                self.untrusted_content_exposure,
                self.exfiltration_channel,
            ]
        )

    @property
    def triggered(self) -> bool:
        return self.conditions_met >= 2


def assess_trifecta(
    answer: str,
    has_citations: bool,
    max_classifier_score_on_context: float,
    exposure_threshold: float = DEFAULT_EXPOSURE_THRESHOLD,
) -> TrifectaAssessment:
    """
    Assess whether an answer + its retrieved context exhibit the
    lethal-trifecta pattern.

    Args:
        answer: the generated answer text.
        has_citations: whether the answer actually cited retrieved
            context (proxy for private/internal data access).
        max_classifier_score_on_context: the highest prompt-injection
            classifier score across all retrieved chunks used to
            build this answer.
        exposure_threshold: minimum classifier score, in [0, 1], for
            a chunk to count as "untrusted content exposure."
            Defaults to the firewall's own FLAG_THRESHOLD so the two
            detectors stay aligned. Override only with a documented
            reason (see the ADR) -- lowering it silently reintroduces
            the baseline-true bug this module was written to fix.

    Returns:
        A TrifectaAssessment recording each condition individually
        (for alerting/audit) plus the aggregate trigger decision.
    """
    if not 0.0 <= exposure_threshold <= 1.0:
        raise ValueError(
            f"exposure_threshold must be in [0, 1], got {exposure_threshold!r}"
        )

    return TrifectaAssessment(
        private_data_access=has_citations,
        untrusted_content_exposure=max_classifier_score_on_context
        >= exposure_threshold,
        exfiltration_channel=bool(_URL_RE.search(answer)),
        exposure_threshold=exposure_threshold,
    )
