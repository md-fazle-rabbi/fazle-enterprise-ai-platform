"""
PII detection and redaction via Presidio, scoped to GDPR Art.9 / HIPAA
Safe Harbor-relevant categories that Presidio's built-in recognizers cover
well out of the box. This is not the complete legal list of either
regime's identifiers, stated here rather than implied by the module name.
"""

import re
from functools import lru_cache

from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import RecognizerResult as AnonymizerRecognizerResult

PII_ENTITIES = [
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "US_SSN",
    "CREDIT_CARD",
    "IBAN_CODE",
    "US_BANK_NUMBER",
    "LOCATION",
    "MEDICAL_LICENSE",
    "US_PASSPORT",
    "US_DRIVER_LICENSE",
    "DATE_TIME",
    "URL",
    "IP_ADDRESS",
]

# Bump this whenever redact_pii's *behavior* changes: a new false-positive
# filter, a new/removed entity in PII_ENTITIES, or a Presidio major-version
# upgrade that changes matching. ingest.py and ingest_image.py compare a
# stored document's pii_analyzer_version against this constant to decide
# whether its chunks were redacted under a stale rule and need to be
# re-derived from the original source. content_hash never changes when
# this bumps -- this version string is the only signal that stored
# redacted text may no longer reflect current behavior.
PII_ANALYZER_VERSION = "2026-09-26-duration-hedge-v2"

# Presidio's own AnalyzerEngine() default pulls in en_core_web_lg, a
# different, much larger spaCy model than the one this repo's Dockerfile
# actually downloads (en_core_web_sm). Left unconfigured, AnalyzerEngine
# discovers en_core_web_lg isn't installed and tries to spacy.cli.download
# it at runtime, which shells out to pip, deliberately stripped from the
# runtime image to close CVEs, and crashes the process instead of failing
# gracefully. Pinning the model here explicitly to en_core_web_sm avoids
# that path entirely by using the model that's actually present.
_NLP_CONFIGURATION = {
    "nlp_engine_name": "spacy",
    "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
}

# Verified against presidio-analyzer==2.2.364 + en_core_web_sm==3.8.16 (this
# repo's pinned versions, per uv.lock): Presidio's DateRecognizer tags a
# relative duration as a TIGHT span -- just "30 days", not a wider phrase
# like "30 days from the date of purchase". The span DOES include a leading
# hedging/qualifier word when the source text has one, e.g. "up to 30 days"
# or "at least 30 days" are each returned as ONE span. The original anchored
# pattern (^\s*\d+...) required the span to start with a digit, so it missed
# every hedged phrasing -- confirmed as the actual cause of "Customers have
# up to 30 days ..." being redacted to "<DATE_TIME>" in a live generated
# answer, even though the same duration phrased without a hedge word in the
# same document's ingested text was correctly left alone.
_RELATIVE_DURATION_PATTERN = re.compile(
    r"^\s*(?:up\s+to|at\s+least|no\s+more\s+than|within|about|approximately|"
    r"roughly|over|under|nearly|almost)?\s*\d+[\s-]*"
    r"(day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes)\s*$",
    re.IGNORECASE,
)


@lru_cache(maxsize=1)
def _get_analyzer() -> AnalyzerEngine:
    nlp_engine = NlpEngineProvider(nlp_configuration=_NLP_CONFIGURATION).create_engine()
    return AnalyzerEngine(nlp_engine=nlp_engine)


@lru_cache(maxsize=1)
def _get_anonymizer() -> AnonymizerEngine:
    # presidio-anonymizer ships no py.typed marker, so mypy --strict
    # sees this constructor as untyped. Not our bug, library limitation.
    return AnonymizerEngine()  # type: ignore[no-untyped-call]


def _is_acronym_false_positive(span: str) -> bool:
    """
    Presidio's spaCy-backed PERSON recognizer assigns a flat 0.85
    confidence to every NER-tagged PERSON span, regardless of the
    underlying model's actual certainty (en_core_web_sm exposes no
    per-entity confidence for Presidio to use instead) — so a
    score_threshold can't separate a real name from a false positive,
    they score identically. In practice en_core_web_sm regularly tags
    single, fully-uppercase technical acronyms ("RAG", "RRF", "API") as
    PERSON. A lone all-caps alphabetic token is essentially never a real
    person's name in running English text, so this heuristic drops it.

    Known limitation, not a guarantee: a name genuinely written in full
    caps (e.g. "SMITH, JOHN" on a scanned intake form) would also be
    missed by this filter.
    """
    return span.isalpha() and span.isupper()


def _is_relative_duration_false_positive(span: str) -> bool:
    """
    Presidio's DateRecognizer scores an absolute date ("March 15, 2024")
    and a relative duration ("30 days", "up to 30 days", "2 weeks")
    identically as DATE_TIME, with no separate entity type or confidence
    signal to tell them apart -- so a score_threshold can't distinguish
    them either, same limitation as the PERSON acronym case above. A
    relative duration on its own carries no identifying information about
    any specific person, so redacting it (turning "up to 30 days" into
    "<DATE_TIME>") destroys the meaning of ordinary business text --
    refund windows, SLAs, notice periods -- for no privacy benefit.

    Verified empirically (see the pattern's own comment) that Presidio
    includes a leading hedge word in the matched span when the source
    text has one ("up to 30 days" is one span, not "30 days" alone), so
    the pattern accepts an optional hedge phrase before the number+unit.

    Known limitation, not a guarantee: a duration expressed entirely in
    words ("thirty days", "a month from now") still isn't caught, since
    the pattern requires digits. A hedge phrasing not in the accepted
    list ("somewhere around 30 days", "roughly a month") would also slip
    through unredacted. Genuine calendar dates ("March 15, 2024",
    "03/15/2024") don't match this pattern and are still redacted, even
    when they appear in the same sentence as a duration (Presidio scores
    them as separate spans, confirmed empirically).
    """
    return bool(_RELATIVE_DURATION_PATTERN.match(span))


def redact_pii(text: str) -> tuple[str, list[str]]:
    """
    Returns (redacted_text, entity_types_found). Default anonymizer
    behavior replaces each match with <ENTITY_TYPE>, not a generic
    [REDACTED], so an audit trail can see what kind of thing was removed
    without ever storing the value itself. Verify this exact replacement
    format against the installed presidio-anonymizer version, it's
    configurable and the default has shifted across major versions before.
    """
    results = _get_analyzer().analyze(text=text, entities=PII_ENTITIES, language="en")
    results = [
        r
        for r in results
        if not (
            r.entity_type == "PERSON"
            and _is_acronym_false_positive(text[r.start : r.end])
        )
        and not (
            r.entity_type == "DATE_TIME"
            and _is_relative_duration_false_positive(text[r.start : r.end])
        )
    ]
    if not results:
        return text, []

    # presidio_analyzer.RecognizerResult and presidio_anonymizer's own
    # RecognizerResult are structurally similar but nominally distinct
    # types, hence the explicit conversion instead of passing analyzer
    # results straight through.
    anonymizer_results = [
        AnonymizerRecognizerResult(
            entity_type=r.entity_type, start=r.start, end=r.end, score=r.score
        )
        for r in results
    ]

    anonymized = _get_anonymizer().anonymize(
        text=text, analyzer_results=anonymizer_results
    )
    entity_types = sorted({r.entity_type for r in results})
    return anonymized.text, entity_types
