"""
20-question vendor AI risk questionnaire, auto-scored 0-100. Score is a
triage signal for prioritizing follow-up, not a pass/fail compliance
verdict, stated explicitly in the output, not implied by a bare number.
"""

from pydantic import BaseModel

QUESTIONS = [
    (
        "Does the vendor publish model cards or equivalent documentation for models used?",
        5,
    ),
    ("Is training data provenance documented?", 5),
    ("Does the vendor support tenant-level data isolation?", 8),
    ("Is data encrypted at rest and in transit?", 6),
    ("Does the vendor have a documented incident response process?", 6),
    ("Is there a named security contact / responsible disclosure process?", 4),
    (
        "Does the vendor undergo third-party security audits (SOC2, ISO 27001, or equivalent)?",
        8,
    ),
    (
        "Is customer data used for further model training without explicit consent?",
        7,
    ),  # inverted, see scoring
    ("Does the vendor provide an SLA for uptime and support response?", 3),
    ("Is there a documented data retention and deletion policy?", 6),
    ("Does the vendor support GDPR Art. 28 processor obligations (DPA available)?", 7),
    ("Is there rate limiting / abuse protection on the vendor's API?", 3),
    ("Does the vendor disclose sub-processors?", 5),
    ("Is there a documented process for model version changes/deprecation notice?", 4),
    ("Does the vendor support audit logging of API usage?", 5),
    ("Is prompt injection / adversarial robustness testing documented?", 6),
    ("Does the vendor have a bug bounty or vulnerability disclosure program?", 4),
    ("Is there geographic data residency control?", 5),
    (
        "Does the vendor provide usage/cost transparency (token counts, per-request cost)?",
        3,
    ),
    ("Is there a clear data processing agreement covering AI-specific risks?", 7),
]

MAX_SCORE = sum(weight for _, weight in QUESTIONS)  # 107, normalized to 100 below
INVERTED_QUESTIONS = {7}  # index of "used for training without consent", yes = bad


class QuestionnaireResponse(BaseModel):
    answers: list[bool]  # len must equal len(QUESTIONS)


class QuestionnaireResult(BaseModel):
    raw_score: int
    normalized_score: int
    risk_tier: str
    flagged_questions: list[str]


def score_questionnaire(response: QuestionnaireResponse) -> QuestionnaireResult:
    if len(response.answers) != len(QUESTIONS):
        raise ValueError(
            f"Expected {len(QUESTIONS)} answers, got {len(response.answers)}"
        )

    raw_score = 0
    flagged = []
    for i, ((question, weight), answer) in enumerate(
        zip(QUESTIONS, response.answers, strict=True)
    ):
        is_good = (not answer) if i in INVERTED_QUESTIONS else answer
        if is_good:
            raw_score += weight
        else:
            flagged.append(question)

    normalized = round((raw_score / MAX_SCORE) * 100)
    tier = (
        "low_risk"
        if normalized >= 80
        else "medium_risk"
        if normalized >= 50
        else "high_risk"
    )

    return QuestionnaireResult(
        raw_score=raw_score,
        normalized_score=normalized,
        risk_tier=tier,
        flagged_questions=flagged,
    )
