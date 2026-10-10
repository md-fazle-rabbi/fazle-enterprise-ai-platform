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


async def assess(text: str) -> InjectionAssessment:
    pattern_hit = pattern_match_score(text) == 1.0
    score = await classifier_score(text)

    if pattern_hit or score >= BLOCK_THRESHOLD:
        action = "block"
    elif score >= FLAG_THRESHOLD:
        action = "flag"
    else:
        action = "allow"

    return InjectionAssessment(
        pattern_hit=pattern_hit, classifier_score=score, action=action
    )


def blocks_stored_content(assessment: InjectionAssessment) -> bool:
    """
    Text that is about to be stored is held to a stricter line than a question.

    A question is used once, by the person who typed it. Stored text is retrieved into
    the model's context later, for any user of the tenant, so one injected document
    keeps working until someone finds it. Measured on this classifier: an injection
    hidden in a long benign document scored 0.88, which is a flag, not a block. For
    stored text a flag is treated as a block. A question still needs a block to be
    refused, so a borderline question is not turned away.
    """
    return assessment.action != "allow"
