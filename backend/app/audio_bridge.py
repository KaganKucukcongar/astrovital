"""Non-blocking, two-way, low-latency PCM bridge for the AstroVital prototype.

Binary WebSocket frames contain exactly 256 unsigned 8-bit mono samples
(8 kHz, 32 ms, 128 = silence). No audio is decoded or saved by the server.

Only the latest WebSocket per role is allowed. Slow receivers cannot stall
telemetry or their counterpart: a bounded per-peer send queue drops the
oldest audio block on overload rather than accumulating delay.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Literal

from fastapi import WebSocket, WebSocketDisconnect

AudioRole = Literal["esp32", "dashboard"]
OPPOSITE: dict[AudioRole, AudioRole] = {
    "esp32": "dashboard",
    "dashboard": "esp32",
}
PCM_FRAME_BYTES = 256
MAX_OUTGOING_BLOCKS = 12  # 384ms of buffered output, not an unbounded queue.


@dataclass(eq=False)
class AudioPeer:
    socket: WebSocket
    outgoing: asyncio.Queue[bytes] = field(
        default_factory=lambda: asyncio.Queue(maxsize=MAX_OUTGOING_BLOCKS)
    )
    sender_task: asyncio.Task[None] | None = None


class AudioBridge:
    def __init__(self) -> None:
        self._peers: dict[AudioRole, AudioPeer] = {}
        self._lock = asyncio.Lock()

    async def status(self) -> dict[str, bool]:
        async with self._lock:
            return {
                "esp32_connected": "esp32" in self._peers,
                "dashboard_connected": "dashboard" in self._peers,
            }

    async def _send_loop(self, peer: AudioPeer) -> None:
        try:
            while True:
                payload = await peer.outgoing.get()
                await peer.socket.send_bytes(payload)
        except (WebSocketDisconnect, RuntimeError, OSError):
            # The receive loop is responsible for unregistering the peer.
            return
        except asyncio.CancelledError:
            raise

    async def _register(self, role: AudioRole, peer: AudioPeer) -> None:
        async with self._lock:
            previous = self._peers.get(role)
            self._peers[role] = peer
            peer.sender_task = asyncio.create_task(
                self._send_loop(peer), name=f"audio-sender-{role}"
            )
        if previous is not None:
            if previous.sender_task:
                previous.sender_task.cancel()
            # A booted/reconnected ESP32 takes over without waiting for a
            # dead old TCP session. Closing it is best-effort, bounded.
            try:
                await asyncio.wait_for(
                    previous.socket.close(code=4000, reason="role replaced"),
                    timeout=0.5,
                )
            except (RuntimeError, OSError, asyncio.TimeoutError):
                pass

    async def _unregister(self, role: AudioRole, peer: AudioPeer) -> None:
        # Guard against a late "disconnect" from a socket that was replaced.
        async with self._lock:
            if self._peers.get(role) is peer:
                self._peers.pop(role, None)
        if peer.sender_task:
            peer.sender_task.cancel()
            try:
                await peer.sender_task
            except (asyncio.CancelledError, RuntimeError, OSError):
                pass

    async def _forward(self, role: AudioRole, payload: bytes) -> None:
        if len(payload) != PCM_FRAME_BYTES:
            return  # Only the agreed 32ms PCM format is forwarded.
        async with self._lock:
            destination = self._peers.get(OPPOSITE[role])
            if destination is None:
                return
            # Discard stale buffered blocks, never stall the WebSocket
            # receiver or another HTTP request due to a slow audio client.
            if destination.outgoing.full():
                try:
                    destination.outgoing.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                destination.outgoing.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    async def handle(self, socket: WebSocket, role_text: str | None) -> None:
        if role_text not in OPPOSITE:
            await socket.close(code=1008, reason="invalid role")
            return

        role: AudioRole = role_text  # type: ignore[assignment]
        await socket.accept()
        peer = AudioPeer(socket=socket)
        await self._register(role, peer)
        try:
            while True:
                message = await socket.receive()
                kind = message.get("type")
                if kind == "websocket.disconnect":
                    break
                # Text/control data is intentionally not audio.
                payload = message.get("bytes")
                if kind == "websocket.receive" and isinstance(payload, bytes):
                    await self._forward(role, payload)
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass
        finally:
            await self._unregister(role, peer)
