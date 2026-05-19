"""Forum indexer HTTP client (Python).

Wraps the read-only /api/* surface served by
keeper/scripts/forum-indexer.mjs (production:
https://forum.gudman.xyz/api). Stdlib-only — no extra deps.

Use for allocator dashboards, reconciliation pipelines, and any
Python tooling that wants the indexed view without standing up
its own RPC node.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "https://forum.gudman.xyz/api"


@dataclass
class HealthResponse:
    ok: bool
    version: str
    last_poll_at: int
    last_block: int
    freshness_sec: int | None
    stale: bool

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> "HealthResponse":
        return cls(
            ok=bool(d["ok"]),
            version=str(d["version"]),
            last_poll_at=int(d["lastPollAt"]),
            last_block=int(d["lastBlock"]),
            freshness_sec=None
            if d.get("freshnessSec") is None
            else int(d["freshnessSec"]),
            stale=bool(d["stale"]),
        )


@dataclass
class IndexerClient:
    """Read-only client for the Forum indexer HTTP API.

    Returns parsed dicts/lists for endpoints whose schemas evolve
    fast (agents, fee-statement, router/*) so the SDK doesn't lag
    schema additions; HealthResponse is dataclass-typed because its
    shape is stable.
    """

    base_url: str = DEFAULT_BASE_URL
    timeout: float = 10.0

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")

    def _get(self, path: str) -> Any:
        req = Request(f"{self.base_url}{path}", headers={"Accept": "application/json"})
        try:
            with urlopen(req, timeout=self.timeout) as r:  # noqa: S310 — known host
                return json.loads(r.read().decode("utf-8"))
        except HTTPError as e:
            raise RuntimeError(f"Forum indexer {path} -> HTTP {e.code}") from e

    def health(self) -> HealthResponse:
        return HealthResponse.from_json(self._get("/health"))

    def agents(self) -> list[dict[str, Any]]:
        return self._get("/agents")

    def agent(self, bot_id: str) -> dict[str, Any]:
        return self._get(f"/agents/{bot_id}")

    def fee_statement(self) -> dict[str, Any]:
        """Phase 6 — per-vault accruals + router splits.

        Live mirror of keeper/scripts/fee-reconcile.mjs's JSON
        output. Same shape so existing cron consumers keep working.
        """
        return self._get("/fee-statement")

    def router_performance(self) -> dict[str, Any]:
        """Phase 5 — CapitalRouter TVL + strategy + lifetime event counters."""
        return self._get("/router/performance")

    def router_activity(self, limit: int = 50) -> list[dict[str, Any]]:
        """Phase 5 — newest-first reallocation receipts stream
        (deposit / withdraw / rebalance / strategy). Server caps at 100."""
        return self._get(f"/router/activity?limit={int(limit)}")
