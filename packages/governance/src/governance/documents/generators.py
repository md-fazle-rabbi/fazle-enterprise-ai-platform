"""
Top-level entry points for generating compliance documents. Each function
ties a document's data (coverage report, RoPA context) to its template
and renders straight to a PDF at output_path, so routers only ever call
one function per document type instead of orchestrating
render_markdown -> markdown_to_pdf themselves.
"""

from datetime import UTC, datetime

from governance.documents.hipaa import build_coverage_report
from governance.documents.renderer import markdown_to_pdf, render_markdown


def generate_hipaa_report(system_name: str, output_path: str) -> str:
    coverage = build_coverage_report()
    md = render_markdown(
        "hipaa_report.md.j2",
        {
            "system_name": system_name,
            "assessment_date": datetime.now(UTC).strftime("%Y-%m-%d"),
            "identifiers": coverage,
            "covered_count": sum(1 for c in coverage if c.covered),
        },
    )
    markdown_to_pdf(md, output_path)
    return md


def generate_gdpr_ropa(context: dict, output_path: str) -> str:
    context.setdefault("generation_date", datetime.now(UTC).strftime("%Y-%m-%d"))
    md = render_markdown("gdpr_ropa.md.j2", context)
    markdown_to_pdf(md, output_path)
    return md
