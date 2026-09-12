"""Needs the Docker socket mounted/accessible, this spins up real containers."""

import pytest
from agent_mesh.sandbox.ast_scanner import UnsafeCodeError
from agent_mesh.sandbox.runner import SandboxExecutionError, run_sandboxed


def test_safe_code_executes_and_returns_output() -> None:
    result = run_sandboxed("print('hello from sandbox')")
    assert "hello from sandbox" in result


def test_ast_scan_blocks_before_container_spins_up() -> None:
    with pytest.raises(UnsafeCodeError):
        run_sandboxed("import os\nos.system('whoami')")


def test_network_is_actually_disabled() -> None:
    with pytest.raises(SandboxExecutionError):
        run_sandboxed(
            "import urllib.request\n"
            "urllib.request.urlopen('http://example.com', timeout=3)"
        )
