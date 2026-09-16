"""
OpenTelemetry setup, exports to Langfuse Cloud's OTel endpoint. See Day 6
part 1 for why this is Cloud, not self-hosted, at this stage.
"""

from core.settings import settings
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def configure_tracing(service_name: str) -> None:
    resource = Resource(attributes={SERVICE_NAME: service_name})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(
        endpoint=f"{settings.langfuse_host}/api/public/otel/v1/traces",
        headers={"Authorization": f"Basic {settings.langfuse_auth_header}"},
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    SQLAlchemyInstrumentor().instrument()


def instrument_app(app) -> None:
    # /health is hit every 10s by Docker's own HEALTHCHECK and by
    # docker-compose's service healthchecks, continuously, for as long as
    # the container runs. Left untraced, it's harmless; left traced, it
    # drowns real traffic in noise and burns through Langfuse's trace
    # quota on the free tier for zero diagnostic value.
    FastAPIInstrumentor.instrument_app(app, excluded_urls="health")
