"""
PII detection and redaction via Presidio, scoped to GDPR Art.9 / HIPAA
Safe Harbor-relevant categories that Presidio's built-in recognizers cover
well out of the box. This is not the complete legal list of either
regime's identifiers, stated here rather than implied by the module name.
"""

from functools import lru_cache

from presidio_analyzer import AnalyzerEngine
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
]


@lru_cache(maxsize=1)
def _get_analyzer() -> AnalyzerEngine:
    return AnalyzerEngine()


@lru_cache(maxsize=1)
def _get_anonymizer() -> AnonymizerEngine:
    # presidio-anonymizer ships no py.typed marker, so mypy --strict
    # sees this constructor as untyped. Not our bug, library limitation.
    return AnonymizerEngine()  # type: ignore[no-untyped-call]


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
