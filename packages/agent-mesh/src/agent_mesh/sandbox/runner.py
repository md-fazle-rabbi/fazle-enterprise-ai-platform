"""
Runs AST-scanned code in a throwaway, network-disabled Docker container.
Container is destroyed immediately after, regardless of success or
failure, nothing from one execution persists to the next.
"""

import docker
import requests
from docker.errors import DockerException

from agent_mesh.sandbox.ast_scanner import ast_scan

RUNNER_IMAGE = "python:3.13.15-slim"
TIMEOUT_SECONDS = 10


class SandboxExecutionError(Exception):
    pass


def run_sandboxed(code: str) -> str:
    ast_scan(code)  # raises UnsafeCodeError, never reaches the container on a hit

    client = docker.from_env()
    container = None
    try:
        container = client.containers.create(
            RUNNER_IMAGE,
            ["python", "-c", code],
            network_disabled=True,
            mem_limit="256m",
            nano_cpus=int(0.5 * 1e9),
            cap_drop=["ALL"],
            pids_limit=50,
            read_only=True,
            tmpfs={"/tmp": "size=16m"},
        )
        container.start()

        try:
            result = container.wait(timeout=TIMEOUT_SECONDS)
        except requests.exceptions.ReadTimeout:
            # Client stopped waiting; container may still be running. Kill it
            # explicitly rather than assuming the timeout stopped anything.
            container.kill()
            raise SandboxExecutionError(
                f"Execution exceeded {TIMEOUT_SECONDS}s timeout, killed"
            )

        logs = container.logs(stdout=True, stderr=True)
        status_code = result.get("StatusCode", 1)
        if status_code != 0:
            raise SandboxExecutionError(
                f"Execution failed (exit {status_code}): "
                f"{logs.decode('utf-8', errors='replace')}"
            )
        return logs.decode("utf-8")

    except DockerException as e:
        raise SandboxExecutionError(f"Sandbox infrastructure error: {e}") from e
    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except DockerException:
                pass
