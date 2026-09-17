"""
HIPAA Safe Harbor de-identification report. The 18 identifier categories
are fixed by 45 CFR 164.514(b)(2). This generates an honest coverage
report against what pii.py's PII_ENTITIES actually contains, it does not
independently verify redaction is working correctly, that's the rag-engine
test suite's job, this documents the claim's current scope.
"""

from pydantic import BaseModel

SAFE_HARBOR_IDENTIFIERS = [
    ("Names", "PERSON"),
    ("Geographic subdivisions smaller than a state", "LOCATION"),
    (
        "All elements of dates (except year) directly related to an individual, and all ages over 89",
        "DATE_TIME",
    ),
    ("Telephone numbers", "PHONE_NUMBER"),
    ("Fax numbers", None),
    ("Email addresses", "EMAIL_ADDRESS"),
    ("Social Security numbers", "US_SSN"),
    ("Medical record numbers", None),
    ("Health plan beneficiary numbers", None),
    ("Account numbers", "US_BANK_NUMBER"),
    ("Certificate/license numbers", "MEDICAL_LICENSE, US_DRIVER_LICENSE"),
    ("Vehicle identifiers and serial numbers", None),
    ("Device identifiers and serial numbers", None),
    ("URLs", "URL"),
    ("IP addresses", "IP_ADDRESS"),
    ("Biometric identifiers", None),
    ("Full-face photographs and comparable images", None),
    ("Any other unique identifying number, characteristic, or code", None),
]


class IdentifierCoverage(BaseModel):
    identifier: str
    covered: bool
    presidio_entity: str | None


def build_coverage_report() -> list[IdentifierCoverage]:
    return [
        IdentifierCoverage(
            identifier=name, covered=entity is not None, presidio_entity=entity
        )
        for name, entity in SAFE_HARBOR_IDENTIFIERS
    ]
