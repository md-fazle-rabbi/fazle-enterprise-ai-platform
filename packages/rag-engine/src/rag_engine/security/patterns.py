"""
Fast, pattern-based injection detection, catches known phrasings in under
a millisecond. Not a complete defense alone, paraphrased attacks slip
past regex easily, this is layer one of two, see classifier.py.
"""

import re

_INJECTION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"ignore (all )?(previous|prior|above) instructions",
        r"disregard (all )?(previous|prior|above)",
        r"you are now (in )?(developer|admin|god|dan) mode",
        r"system\s*:\s*",
        r"new instructions?\s*:",
        r"reveal (your |the )?(system prompt|instructions)",
        r"forget (everything|all) (you|above)",
        r"\[?end of (context|document|data)\]?.{0,20}(system|assistant|instruction)",
    ]
]


def pattern_match_score(text: str) -> float:
    """1.0 if any known pattern matches, else 0.0. Binary on purpose, a
    regex hit is either a known phrase or it isn't."""
    return 1.0 if any(p.search(text) for p in _INJECTION_PATTERNS) else 0.0
