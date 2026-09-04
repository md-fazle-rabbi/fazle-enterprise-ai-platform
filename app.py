"""
Hugging Face Spaces entry point (free CPU tier, Gradio SDK — Docker SDK
requires a paid plan as of mid-2026). Gradio's own server runs on FastAPI
under the hood, so the actual rag-engine FastAPI app is mounted onto that
same ASGI app rather than run separately. All existing routes (/docs,
/health, /ready, /ingest, /query, /search, ...) work unchanged; the
Gradio UI at /ui is a placeholder that satisfies HF's "must have a demo
tab" expectation, real traffic never touches it.
"""

import gradio as gr
from rag_engine.main import app as fastapi_app


def _status() -> str:
    return "rag-engine is running. See /docs for the API."


demo = gr.Interface(
    fn=_status,
    inputs=None,
    outputs="text",
    title="fazle-enterprise-ai-platform",
    description="Enterprise RAG + agentic AI platform. API docs at /docs.",
)

app = gr.mount_gradio_app(fastapi_app, demo, path="/ui")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=7860)
