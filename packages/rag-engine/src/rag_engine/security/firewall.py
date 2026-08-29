"""
Combines both layers into one risk assessment. Neither layer alone is a
complete defense, this is risk reduction, not elimination.
"""

from dataclasses import dataclass

from rag_engine.security.classifier import classifier_score
from rag_engine.security.patterns import pattern_match_score

BLOCK_THRESHOLD = 0.95
FLAG_THRESHOLD = 0.60


@dataclass
class InjectionAssessment:
    pattern_hit: bool
    classifier_score: float
    action: str  # "allow" | "flag" | "block"


def assess(text: str) -> InjectionAssessment:
    pattern_hit = pattern_match_score(text) == 1.0
    score = classifier_score(text)

    if pattern_hit or score >= BLOCK_THRESHOLD:
        action = "block"
    elif score >= FLAG_THRESHOLD:
        action = "flag"
    else:
        action = "allow"

    return InjectionAssessment(
        pattern_hit=pattern_hit, classifier_score=score, action=action
    )
