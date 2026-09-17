"""
PII detection and redaction via Presidio, scoped to GDPR Art.9 / HIPAA
Safe Harbor-relevant categories that Presidio's built-in recognizers cover
well out of the box. This is not the complete legal list of either
regime's identifiers, stated here rather than implied by the module name.
"""

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
