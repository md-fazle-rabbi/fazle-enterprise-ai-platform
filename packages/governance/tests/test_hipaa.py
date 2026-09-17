from governance.documents.hipaa import build_coverage_report


def test_coverage_report_has_18_identifiers():
    assert len(build_coverage_report()) == 18


def test_covered_count_matches_actual_entities():
    coverage = build_coverage_report()
    covered = sum(1 for c in coverage if c.covered)
    assert (
        covered == 10
    )  # update this number if PII_ENTITIES or SAFE_HARBOR_IDENTIFIERS changes, that's the point


def test_uncovered_identifiers_are_named_not_hidden():
    coverage = build_coverage_report()
    uncovered_names = {c.identifier for c in coverage if not c.covered}
    assert "Biometric identifiers" in uncovered_names
    assert "Medical record numbers" in uncovered_names
