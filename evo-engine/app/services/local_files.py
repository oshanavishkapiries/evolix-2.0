"""Authenticated local file transport; bounded reads and response-lifetime pins."""
import os
import re

from fastapi import HTTPException
from fastapi.responses import Response, StreamingResponse

from app.services.local_storage import validate_file_id
from app.services.storage import local_storage


class PinnedFileResponse(StreamingResponse):
    def __init__(self, provider, file_id, handle, start, length, **kwargs):
        self.provider, self.file_id, self.handle = provider, file_id, handle

        def chunks():
            handle.seek(start)
            remaining = length
            while remaining:
                chunk = handle.read(min(1024 * 256, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

        super().__init__(chunks(), **kwargs)

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.provider.close_file(self.file_id, self.handle)


def _range(value, size):
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
    if not match or not any(match.groups()) or size == 0:
        raise ValueError("Unsatisfiable range")
    left, right = match.groups()
    if not left:
        suffix = int(right)
        if suffix <= 0:
            raise ValueError("Unsatisfiable range")
        return max(0, size - suffix), size - 1
    start, end = int(left), min(int(right), size - 1) if right else size - 1
    if start >= size or end < start:
        raise ValueError("Unsatisfiable range")
    return start, end


def file_response(file_id, request):
    try:
        validate_file_id(file_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    provider = local_storage()
    try:
        # Touch only after the request is known to be successful.
        handle = provider.open_file(file_id, touch=False)
    except (FileNotFoundError, IsADirectoryError):
        raise HTTPException(404, "Local CDN file missing or evicted")
    handed_off = False
    try:
        size = os.fstat(handle.fileno()).st_size
        # mtime tracks LRU; upload time is a stable entity validator instead.
        etag = f'"{file_id}-{size}"'
        mime = {"mp4": "video/mp4", "mkv": "video/x-matroska", "vtt": "text/vtt", "webm": "video/webm"}.get(file_id.rsplit(".", 1)[-1], "application/octet-stream")
        headers = {"Accept-Ranges": "bytes", "Content-Type": mime, "ETag": etag, "Cache-Control": "private, max-age=3600"}
        start, end, status = 0, size - 1, 200
        value = request.headers.get("range")
        if_range = request.headers.get("if-range")
        # Entity tags are stable despite last-access touches. Date validators
        # cannot safely identify a version here, so send the full representation.
        if value and (not if_range or if_range == etag):
            try:
                start, end = _range(value, size)
            except ValueError:
                return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}", "Content-Length": "0"})
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        length = max(0, end - start + 1)
        headers["Content-Length"] = str(length)
        if request.method == "HEAD":
            return Response(status_code=status, headers=headers)
        provider.touch(file_id)
        response = PinnedFileResponse(provider, file_id, handle, start, length, status_code=status, headers=headers)
        handed_off = True
        return response
    finally:
        if not handed_off:
            provider.close_file(file_id, handle)
