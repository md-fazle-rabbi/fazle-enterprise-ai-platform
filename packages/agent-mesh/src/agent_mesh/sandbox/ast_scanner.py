"""
Static AST scan, runs before any container spins up. Catches the obvious
cases fast and free, deliberately conservative, false positives (blocking
something harmless) are the acceptable failure mode here, false negatives
are not.
"""

import ast

DANGEROUS_IMPORTS = {
    "os",
    "subprocess",
    "socket",
    "ctypes",
    "sys",
    "shutil",
    "pty",
    "pickle",
}
DANGEROUS_CALLS = {"eval", "exec", "__import__", "compile"}


class UnsafeCodeError(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def ast_scan(code: str) -> None:
    """Raises UnsafeCodeError if the code contains anything on the deny
    list. Returns None (doesn't return a bool) so a caller can't
    accidentally ignore a rejection by forgetting to check a return value."""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise UnsafeCodeError(f"Code does not parse: {e}") from e

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = {alias.name.split(".")[0] for alias in node.names}
            # For `from X import Y`, alias.name is Y, not X — the module
            # itself only shows up on node.module, so it has to be added
            # separately or `from subprocess import run` slips right past.
            if isinstance(node, ast.ImportFrom) and node.module:
                names.add(node.module.split(".")[0])
            if hit := names & DANGEROUS_IMPORTS:
                raise UnsafeCodeError(f"Disallowed import: {', '.join(hit)}")

        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in DANGEROUS_CALLS
        ):
            raise UnsafeCodeError(f"Disallowed call: {node.func.id}()")

        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "open"
            and any(
                isinstance(a, ast.Constant)
                and isinstance(a.value, str)
                and "w" in a.value
                for a in node.args[1:2]
            )
        ):
            raise UnsafeCodeError("Disallowed call: open() in write mode")
