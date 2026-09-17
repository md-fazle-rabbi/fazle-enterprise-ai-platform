"""
Model-card registry: every model this platform calls, documented once,
referenced everywhere, not scattered across code comments. Entries here
are cross-checked against actual usage (eu_ai_act.py, crag.py,
generation.py, graph_stub.py, colorado_admt.py, embeddings.py,
security/classifier.py), not assumed from what a typical stack would use.
"""

from pydantic import BaseModel


class ModelCard(BaseModel):
    name: str
    provider: str
    intended_use: str
    known_limitations: list[str]


MODEL_REGISTRY: dict[str, ModelCard] = {
    "gemini-3.5-flash-lite": ModelCard(
        name="gemini-3.5-flash-lite",
        provider="Google",
        intended_use="Answer generation (generation.py), CRAG relevance grading (crag.py), entity extraction (graph_stub.py)",
        known_limitations=[
            "Can still produce fluent but ungrounded text if citation enforcement is bypassed",
            "15 RPM / 500 RPD free-tier quota shared across all callers of this model id",
        ],
    ),
    "gemini-3.1-flash-lite": ModelCard(
        name="gemini-3.1-flash-lite",
        provider="Google",
        intended_use="EU AI Act risk-tier classification (eu_ai_act.py), Colorado ADMT classification (colorado_admt.py)",
        known_limitations=[
            "Own quota pool, separate from gemini-3.5-flash-lite, but same 15 RPM / 500 RPD cap",
            "Classification tasks (legal/regulatory) are judgment calls, not authoritative legal determinations",
        ],
    ),
    "voyage-4-large": ModelCard(
        name="voyage-4-large",
        provider="Voyage AI",
        intended_use="Document and query embeddings for retrieval (embeddings.py)",
        known_limitations=[
            "Retrieval quality depends on chunking strategy; embeddings alone don't guarantee relevance"
        ],
    ),
    "meta-llama/Llama-Prompt-Guard-2-86M": ModelCard(
        name="Llama Prompt Guard 2 (86M)",
        provider="Meta",
        intended_use="Injection/jailbreak classification, layer 2 of the firewall (security/classifier.py)",
        known_limitations=[
            "Documented false-positive rate on legitimate security-adjacent text",
            "Not effective alone against paraphrased attacks without layer 1 pattern matching",
        ],
    ),
}
