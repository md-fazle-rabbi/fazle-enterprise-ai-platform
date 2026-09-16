"""
Two load profiles, deliberately separate. InfraOnlyUser hits /health, no
LLM calls, free to run at any volume. FullPipelineUser hits /query, which
calls Claude twice (CRAG grade + generation) and Voyage once per request,
real API cost, keep user count and runtime small on purpose, this is for
one honest measurement, not a stress test run repeatedly for fun.
"""

import uuid

from locust import HttpUser, between, task

TEST_TENANT = str(uuid.uuid4())


class InfraOnlyUser(HttpUser):
    wait_time = between(0.1, 0.5)

    @task
    def health(self):
        self.client.get("/health")


class FullPipelineUser(HttpUser):
    wait_time = between(22, 28)

    @task
    def query(self):
        self.client.post(
            "/query",
            json={"question": "How does this system enforce tenant isolation?"},
            headers={"X-Tenant-ID": TEST_TENANT},
        )
