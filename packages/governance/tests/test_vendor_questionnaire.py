import pytest
from governance.vendor_questionnaire import (
    QUESTIONS,
    QuestionnaireResponse,
    score_questionnaire,
)


def test_all_good_answers_scores_100():
    answers = [i not in {7} for i in range(len(QUESTIONS))]
    result = score_questionnaire(QuestionnaireResponse(answers=answers))
    assert result.normalized_score == 100
    assert result.risk_tier == "low_risk"
    assert result.flagged_questions == []


def test_all_bad_answers_scores_zero():
    answers = [i in {7} for i in range(len(QUESTIONS))]
    result = score_questionnaire(QuestionnaireResponse(answers=answers))
    assert result.normalized_score == 0
    assert result.risk_tier == "high_risk"
    assert len(result.flagged_questions) == len(QUESTIONS)


def test_inverted_question_scores_correctly():
    # answering "yes, vendor DOES use customer data for training without consent"
    # should count AGAINST the score, not for it
    answers = [True] * len(QUESTIONS)  # includes True for the inverted question
    result = score_questionnaire(QuestionnaireResponse(answers=answers))
    assert QUESTIONS[7][0] in result.flagged_questions


def test_wrong_answer_count_raises():
    with pytest.raises(ValueError, match="Expected 20"):
        score_questionnaire(QuestionnaireResponse(answers=[True] * 19))
