"""
A conversation must be committed before its creation response is sent. The web app saves
the first exchange right after it gets the new conversation's id, so a commit that happens
after the response races that request and the save fails with a 404.

FastAPI runs the cleanup of a dependency that uses `yield` after the response is sent,
unless the dependency is declared with scope="function". get_user_session commits in that
cleanup, so every conversation route must declare the function scope.
"""

from fastapi.routing import APIRoute
from rag_engine.db import get_user_session
from rag_engine.routers.conversations import router


def test_every_conversation_route_commits_before_the_response_is_sent() -> None:
    checked = 0
    for route in router.routes:
        assert isinstance(route, APIRoute)
        for dependency in route.dependant.dependencies:
            if dependency.call is get_user_session:
                checked += 1
                assert dependency.scope == "function", (
                    f"{route.methods} {route.path} commits after the response is sent"
                )
    assert checked == 5
