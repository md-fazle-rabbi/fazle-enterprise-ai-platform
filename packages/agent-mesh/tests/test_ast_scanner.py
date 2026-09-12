import pytest
from agent_mesh.sandbox.ast_scanner import UnsafeCodeError, ast_scan


def test_allows_safe_code() -> None:
    ast_scan("x = 1 + 1\nprint(x)")  # no exception


def test_rejects_os_import() -> None:
    with pytest.raises(UnsafeCodeError, match="os"):
        ast_scan("import os\nos.system('ls')")


def test_rejects_subprocess_import() -> None:
    with pytest.raises(UnsafeCodeError, match="subprocess"):
        ast_scan("from subprocess import run")


def test_rejects_eval() -> None:
    with pytest.raises(UnsafeCodeError, match="eval"):
        ast_scan("eval('1+1')")


def test_rejects_exec() -> None:
    with pytest.raises(UnsafeCodeError, match="exec"):
        ast_scan("exec('print(1)')")


def test_rejects_syntax_errors_cleanly() -> None:
    with pytest.raises(UnsafeCodeError, match="does not parse"):
        ast_scan("def f(:\n  pass")
