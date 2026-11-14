"""
Vercel serverless entry point.

Vercel's Python runtime imports this module and serves the module-level
ASGI ``app`` (FastAPI) for every request routed here by ``vercel.json``
(``/api/*`` and ``/tts/*``).

If importing the backend fails (e.g. a dependency is missing from the
serverless bundle), a dependency-free fallback ASGI app is served instead
so the real error is visible over HTTP instead of an opaque
FUNCTION_INVOCATION_FAILED page.
"""
import os
import sys
import traceback

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

try:
    from backend.app import app  # noqa: E402,F401  (ASGI app consumed by Vercel)
except Exception:  # pragma: no cover - diagnostics only
    import json

    _TB = traceback.format_exc()

    class _BackendImportErrorApp:
        """Minimal stdlib ASGI app that reports the import error as JSON."""

        async def __call__(self, scope, receive, send):
            if scope["type"] != "http":
                return
            body = json.dumps(
                {"error": "backend import failed", "detail": _TB[-1800:]}
            ).encode("utf-8")
            headers = [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ]
            await send({"type": "http.response.start", "status": 500, "headers": headers})
            await send({"type": "http.response.body", "body": body})

    app = _BackendImportErrorApp()  # noqa: F401
