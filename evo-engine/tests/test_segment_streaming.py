import asyncio
import http.server
import threading
import unittest
from types import SimpleNamespace
from unittest import mock

from curl_cffi.requests import Headers
from fastapi import HTTPException, Request
from starlette.requests import ClientDisconnect

from app.api import routes
from app.services.hls_proxy import HlsProxyService, close_segment


class Upstream:
    def __init__(self, status=200, headers=None, chunks=(b"first", b"second"), error=None):
        self.status_code = status
        self.headers = Headers(headers or {})
        self.chunks = chunks
        self.error = error
        self.reads = 0
        self.closed = False
        self.astream_task = None

    @property
    def content(self):
        raise AssertionError("segments must never be buffered")

    async def aiter_content(self):
        for chunk in self.chunks:
            self.reads += 1
            yield chunk
        if self.error:
            raise self.error

    async def aclose(self):
        self.closed = True


class SegmentStreaming(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.proxy = HlsProxyService()
        self.addAsyncCleanup(self.proxy._session.close)
        self.session = SimpleNamespace(get=mock.AsyncMock(), head=mock.AsyncMock())
        self.proxy._session, self.real_session = self.session, self.proxy._session
        self.task = SimpleNamespace(upstream_headers={"Referer": "https://player.test"})
        self.url = "https://cdn.test/segment.ts"
        self.sig = self.proxy.sign("task", self.url)
        self.patchers = [mock.patch.object(routes, "_hls_proxy", self.proxy),
                         mock.patch.object(routes, "_stream_task", return_value=self.task)]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    async def response(self, upstream, method="GET", range_header=None, sig=None):
        self.session.get.return_value = upstream
        self.session.head.return_value = upstream
        return await routes.get_proxy_stream_segment(
            "task", Request({"type": "http", "method": method}), url=self.url,
            sig=self.sig if sig is None else sig, range_header=range_header)

    async def send_response(self, response, send=None, spec="2.4", receive=None):
        messages = []

        async def collect(message):
            messages.append(message)

        async def never_disconnect():
            await asyncio.Event().wait()

        await response({"type": "http", "asgi": {"spec_version": spec}},
                       receive or never_disconnect, send or collect)
        return messages

    async def test_chunks_are_sent_before_next_upstream_read_and_complete(self):
        upstream = Upstream(headers={"Content-Type": "video/mp2t", "Content-Length": "11"})
        response = await self.response(upstream)
        self.assertEqual(upstream.reads, 0)
        chunks = []

        async def send(message):
            if message["type"] == "http.response.body" and message.get("body"):
                chunks.append(message["body"])
                self.assertEqual(upstream.reads, len(chunks))

        await self.send_response(response, send)
        self.assertEqual(chunks, [b"first", b"second"])
        self.assertTrue(upstream.closed)
        self.assertEqual(response.headers["content-length"], "11")
        self.assertNotIn("accept-ranges", response.headers)
        self.assertEqual(response.headers["access-control-allow-origin"], "*")
        self.assertEqual(self.session.get.call_args.kwargs["timeout"], 15)
        self.assertTrue(self.session.get.call_args.kwargs["stream"])

    async def test_partial_content_and_range_request_passthrough(self):
        upstream = Upstream(206, {"Content-Type": "video/mp4", "Content-Length": "6",
                                  "Content-Range": "bytes 5-10/100", "Accept-Ranges": "bytes"}, (b"second",))
        response = await self.response(upstream, range_header="bytes=5-10")
        self.assertEqual(response.status_code, 206)
        for name, value in upstream.headers.items():
            self.assertEqual(response.headers[name], value)
        self.assertEqual(self.session.get.call_args.kwargs["headers"]["Range"], "bytes=5-10")
        await self.send_response(response)

    async def test_head_does_not_read_body_and_keeps_length(self):
        upstream = Upstream(headers={"Content-Length": "999", "Content-Type": "text/plain"})
        response = await self.response(upstream, "HEAD")
        self.assertEqual(response.body, b"")
        self.assertEqual(response.headers["content-length"], "999")
        self.assertEqual(response.headers["content-type"], "video/mp2t")
        self.assertEqual(upstream.reads, 0)
        self.assertTrue(upstream.closed)
        self.session.get.assert_not_called()

    async def test_rejected_head_falls_back_to_streaming_get_without_reading(self):
        for status in (405, 501):
            rejected, upstream = Upstream(status), Upstream(headers={"Content-Length": "42"})
            self.session.head.return_value = rejected
            self.session.get.return_value = upstream
            response = await routes.get_proxy_stream_segment(
                "task", Request({"type": "http", "method": "HEAD"}), self.url, self.sig, None)
            self.assertEqual(response.headers["content-length"], "42")
            self.assertTrue(rejected.closed and upstream.closed)
            self.assertEqual(upstream.reads, 0)

    async def test_upstream_errors_have_small_bodies_and_preserve_status_and_range(self):
        for status in (404, 416):
            upstream = Upstream(status, {"Content-Length": "999999", "Content-Range": "bytes */100"})
            response = await self.response(upstream)
            self.assertEqual(response.status_code, status)
            self.assertLess(len(response.body), 100)
            self.assertEqual(int(response.headers["content-length"]), len(response.body))
            self.assertEqual(response.headers["content-range"], "bytes */100")
            self.assertEqual(upstream.reads, 0)
            self.assertTrue(upstream.closed)

    async def test_disconnect_during_send_closes_upstream(self):
        upstream = Upstream()
        response = await self.response(upstream)

        async def disconnect(message):
            if message["type"] == "http.response.body":
                raise OSError("client disconnected")

        with self.assertRaises(ClientDisconnect):
            await self.send_response(response, disconnect)
        self.assertTrue(upstream.closed)
        self.assertEqual(upstream.reads, 1)

    async def test_disconnect_before_iteration_also_closes(self):
        upstream = Upstream()
        response = await self.response(upstream)

        async def receive():
            return {"type": "http.disconnect"}

        async def send(message):
            await asyncio.Event().wait()

        await self.send_response(response, send, spec="2.3", receive=receive)
        self.assertTrue(upstream.closed)
        self.assertEqual(upstream.reads, 0)

    async def test_body_error_closes_upstream(self):
        upstream = Upstream(error=RuntimeError("upstream failed"))
        response = await self.response(upstream)
        with self.assertRaisesRegex(RuntimeError, "upstream failed"):
            await self.send_response(response)
        self.assertTrue(upstream.closed)

    async def test_connection_and_timeout_failures_still_return_502(self):
        for error in (OSError("connection failed"), TimeoutError("first byte timed out")):
            self.session.get.side_effect = error
            with self.assertRaises(HTTPException) as caught:
                await self.response(Upstream())
            self.assertEqual(caught.exception.status_code, 502)

    async def test_bad_signature_remains_403_without_upstream_request(self):
        with self.assertRaises(HTTPException) as caught:
            await self.response(Upstream(), sig="bad")
        self.assertEqual(caught.exception.status_code, 403)
        self.session.get.assert_not_called()
        self.session.head.assert_not_called()


class RealCurlStreaming(unittest.IsolatedAsyncioTestCase):
    async def test_first_chunk_arrives_before_upstream_finishes_and_close_aborts(self):
        release = threading.Event()

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", "11")
                self.end_headers()
                self.wfile.write(b"first")
                self.wfile.flush()
                release.wait(5)
                try:
                    self.wfile.write(b"second")
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        proxy = HlsProxyService()
        try:
            upstream = await asyncio.wait_for(proxy.fetch_segment(
                f"http://127.0.0.1:{server.server_port}/segment", SimpleNamespace(upstream_headers={})), 2)
            chunks = upstream.aiter_content()
            self.assertEqual(await asyncio.wait_for(anext(chunks), 2), b"first")
            self.assertFalse(release.is_set())
            await asyncio.wait_for(close_segment(upstream), 1)
            self.assertTrue(upstream.astream_task.done())
            await chunks.aclose()
        finally:
            release.set()
            await proxy._session.close()
            await asyncio.to_thread(server.shutdown)
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
