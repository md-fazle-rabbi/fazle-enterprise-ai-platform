"""
Shared Markdown -> PDF rendering for governance documents. Jinja2 renders
a template into Markdown text (so the source stays diffable and readable
in code review), the `markdown` library converts that to HTML, and
WeasyPrint turns the HTML into a PDF. Callers (generators.py) own the
per-document context and output path; this module only knows how to
render, not what.
"""

import markdown
from jinja2 import Environment, PackageLoader
from weasyprint import HTML

_env = Environment(loader=PackageLoader("governance", "documents/templates"))


def render_markdown(template_name: str, context: dict) -> str:
    return _env.get_template(template_name).render(**context)


def markdown_to_pdf(md_content: str, output_path: str) -> None:
    html_content = markdown.markdown(md_content, extensions=["tables"])
    HTML(string=html_content).write_pdf(output_path)
