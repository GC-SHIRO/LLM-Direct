"""Minimal bearer-token guard for the HTTP transport (pure ASGI, keeps streaming intact)."""

from __future__ import annotations

import hmac
import json


class BearerTokenMiddleware:
    def __init__(self, app, token: str):
        self.app = app
        self._token = token.encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":  # lifespan etc.
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"")
        supplied = auth[7:].strip() if auth[:7].lower() == b"bearer " else b""
        if supplied and hmac.compare_digest(supplied, self._token):
            return await self.app(scope, receive, send)
        body = json.dumps({"error": "unauthorized: send 'Authorization: Bearer <token>'"}).encode()
        await send({"type": "http.response.start", "status": 401,
                    "headers": [(b"content-type", b"application/json"),
                                (b"www-authenticate", b"Bearer"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
