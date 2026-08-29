"""
Golden evaluation set for the RAGAS gate. Five questions against a small
fixed corpus this script ingests itself, so the eval never depends on
whatever happens to already be sitting in a dev database.
"""

GOLDEN_CORPUS = [
    {
        "source_path": "eval/rls.md",
        "text": (
            "# Row-Level Security\n\n"
            "Postgres Row-Level Security isolates tenants at the database "
            "layer, not the application layer. Every table with tenant data "
            "gets a tenant_id column and a policy using "
            "current_setting('app.tenant_id'). FORCE ROW LEVEL SECURITY makes "
            "the policy apply even to the table owner."
        ),
    },
    {
        "source_path": "eval/chunking.md",
        "text": (
            "# Chunking\n\nThe chunking strategy is token-aware and "
            "structure-aware. Markdown is split by heading first, then "
            "packed into chunks up to a 400 token budget using whole "
            "paragraphs, never splitting mid-paragraph unless a single "
            "paragraph alone exceeds the budget."
        ),
    },
    {
        "source_path": "eval/search.md",
        "text": (
            "# Hybrid Search\n\nSearch combines dense vector similarity from "
            "pgvector with Postgres native full-text ranking, fused using "
            "Reciprocal Rank Fusion with k=60. Dense search alone misses "
            "exact keyword matches; sparse search alone misses paraphrases."
        ),
    },
]

GOLDEN_QUESTIONS = [
    {
        "question": "What makes Row-Level Security apply even to the table owner?",
        "ground_truth": "FORCE ROW LEVEL SECURITY makes the policy apply even to the table owner.",
    },
    {
        "question": "What is the token budget used for chunking?",
        "ground_truth": "Chunks are packed up to a 400 token budget.",
    },
    {
        "question": "What value of k is used for Reciprocal Rank Fusion?",
        "ground_truth": "k=60 is used for Reciprocal Rank Fusion.",
    },
    {
        "question": "Does RLS enforce isolation at the application layer or the database layer?",
        "ground_truth": "RLS enforces isolation at the database layer, not the application layer.",
    },
    {
        "question": "What does sparse search catch that dense search alone misses?",
        "ground_truth": "Sparse search catches exact keyword matches that dense search can miss.",
    },
]
