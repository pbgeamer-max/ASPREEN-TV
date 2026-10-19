# -*- coding: utf-8 -*-
"""
=============================================================================
   ASPREEN TV ▸ Seamless TS → HLS Engine (محرك البث المتصل بدون انقطاع)
=============================================================================
المشكلة القديمة:
  - FFmpeg كان يتصل بالمصدر مباشرة، فعند كل فصل من المزود يموت FFmpeg ويُعاد تشغيله
    (فجوة 1-3 ثوانٍ = تقطيع).
  - مزودات IPTV عند إعادة الاتصال ترسل "دفعة" من آخر ثوانٍ مخزنة (burst) فكانت تُضاف
    كشرائح جديدة → المشاهد يرى آخر 3-5 ثوانٍ تتكرر (الرجوع للخلف).
  - أسماء الشرائح كانت تتكرر بعد كل جلسة جديدة (index0.ts...) مع كاش immutable
    → المتصفح/الذاكرة يعيدان شرائح قديمة.
  - سباق (race) بين الجلسة القديمة والجديدة كان يحذف ملفات الجلسة الجديدة.

الحل هنا:
  1. Python يقرأ المصدر بنفسه ويعيد الاتصال تلقائياً، ويغذي FFmpeg واحداً عبر stdin.
     FFmpeg لا يعرف أن المصدر انقطع أصلاً → لا إعادة تشغيل، لا فجوة.
  2. بعد كل إعادة اتصال: نسقط أي حزمة PTS الخاصة بها <= آخر PTS أُرسل (إزالة التكرار).
  3. كل جلسة لها مجلد ومعرّف فريد، وكل جيل FFmpeg له بادئة أسماء فريدة.
  4. كل جلسة تحذف ملفاتها هي فقط، ولا تلمس جلسة أحدث بنفس القناة.
=============================================================================
"""

import os
import sys
import ssl
import time
import uuid
import shutil
import threading
import subprocess
import urllib.request

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
except Exception:
    pass

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

TS_PACKET = 188
SYNC_BYTE = 0x47
PTS_WRAP = 1 << 33
PTS_RESYNC_WINDOW = 90000 * 60  # 60s: أي قفزة أكبر من هذا تُعتبر إعادة تشغيل للمشفر فنقبلها

UPSTREAM_READ_TIMEOUT = 8       # ثوانٍ بدون بيانات = إعادة اتصال
IDLE_TIMEOUT = 75               # إيقاف الجلسة إذا لم يطلبها أي مشاهد
HLS_TIME = 4
HLS_LIST_SIZE = 8


def _is_single_connection_line(url: str) -> bool:
    return "mac=" in url or "hey-ott.net" in url


def _extract_pts(pkt: bytes, offset: int):
    """Returns (pid, pusi, pts|None) for a single TS packet starting at offset."""
    b1 = pkt[offset + 1]
    pid = ((b1 & 0x1F) << 8) | pkt[offset + 2]
    pusi = bool(b1 & 0x40)
    if not pusi:
        return pid, False, None
    afc = (pkt[offset + 3] >> 4) & 0x03
    p = offset + 4
    if afc == 2:
        return pid, True, None
    if afc == 3:
        p += 1 + pkt[offset + 4]
    end = offset + TS_PACKET
    if p + 14 > end:
        return pid, True, None
    if pkt[p] != 0 or pkt[p + 1] != 0 or pkt[p + 2] != 1:
        return pid, True, None  # PSI table (PAT/PMT) – not a PES
    stream_id = pkt[p + 3]
    if not (0xC0 <= stream_id <= 0xEF or stream_id == 0xBD):
        return pid, True, None
    if not (pkt[p + 7] & 0x80):
        return pid, True, None
    q = p + 9
    pts = (((pkt[q] >> 1) & 0x07) << 30) | (pkt[q + 1] << 22) | ((pkt[q + 2] >> 1) << 15) | (pkt[q + 3] << 7) | (pkt[q + 4] >> 1)
    return pid, True, pts


def _pts_is_newer(pts: int, last: int) -> bool:
    diff = (pts - last) % PTS_WRAP
    if diff == 0:
        return False
    if diff < PTS_WRAP // 2:
        return True  # forward (handles 33-bit wrap)
    # backwards: only accept if it is a huge jump (encoder restart on provider side)
    return (last - pts) % PTS_WRAP > PTS_RESYNC_WINDOW


class _TsSplicer:
    """Keeps TS packet alignment and removes replayed packets after an upstream reconnect."""

    def __init__(self):
        self.remainder = b""
        self.synced = False
        self.last_pts = {}     # pid -> last forwarded PTS
        self.gated = set()     # pids waiting for PTS > last_pts after reconnect
        self.dropped = 0

    def on_reconnect(self):
        self.remainder = b""
        self.synced = False
        self.gated = set(self.last_pts.keys())

    def feed(self, data: bytes) -> bytes:
        buf = self.remainder + data
        if not self.synced:
            idx = -1
            limit = len(buf) - 2 * TS_PACKET
            for i in range(0, max(0, limit)):
                if buf[i] == SYNC_BYTE and buf[i + TS_PACKET] == SYNC_BYTE and buf[i + 2 * TS_PACKET] == SYNC_BYTE:
                    idx = i
                    break
            if idx < 0:
                self.remainder = buf[-2 * TS_PACKET:]
                return b""
            buf = buf[idx:]
            self.synced = True

        usable = (len(buf) // TS_PACKET) * TS_PACKET
        self.remainder = buf[usable:]
        if usable == 0:
            return b""

        out = bytearray()
        gated = self.gated
        last_pts = self.last_pts
        for off in range(0, usable, TS_PACKET):
            if buf[off] != SYNC_BYTE:
                # lost sync mid-chunk: resync on next feed
                self.synced = False
                self.remainder = buf[off:]
                break
            pid, pusi, pts = _extract_pts(buf, off)
            if pts is not None:
                prev = last_pts.get(pid)
                if pid in gated:
                    if prev is None or _pts_is_newer(pts, prev):
                        gated.discard(pid)
                    else:
                        self.dropped += 1
                        continue
                last_pts[pid] = pts
            elif pid in gated:
                # continuation of a replayed PES, or PES start without PTS while gated
                self.dropped += 1
                continue
            out += buf[off:off + TS_PACKET]
        return bytes(out)


class OnDemandStreamManager:
    def __init__(self, base_dir, maintenance_callback=None):
        self.base_dir = base_dir
        self.workers = {}   # stream_key -> worker dict
        self.lock = threading.Lock()
        self.maintenance_callback = maintenance_callback
        self.log_dir = os.path.join(base_dir, "_logs")
        os.makedirs(self.log_dir, exist_ok=True)
        # Remove leftovers of previous runs (old names would collide with nothing now, but free disk)
        for name in os.listdir(base_dir):
            if name != "_logs":
                shutil.rmtree(os.path.join(base_dir, name), ignore_errors=True)
        threading.Thread(target=self._cleanup_loop, daemon=True).start()

    # ------------------------------------------------------------------ public API
    def get_or_start_stream(self, cid, server_id, upstream_url, wait_seconds=25):
        """Returns (stream_key, session_id, playlist_text|None)."""
        stream_key = f"{cid}_s{server_id}"
        to_stop = []
        with self.lock:
            worker = self.workers.get(stream_key)
            if worker and (worker["stopped"].is_set() or worker["upstream_url"] != upstream_url):
                to_stop.append(self.workers.pop(stream_key))
                worker = None
            if worker is None:
                if _is_single_connection_line(upstream_url):
                    for k, w in list(self.workers.items()):
                        if _is_single_connection_line(w["upstream_url"]):
                            to_stop.append(self.workers.pop(k))
                worker = self._new_worker(stream_key, upstream_url)
                self.workers[stream_key] = worker
                starting = True
            else:
                starting = False
            worker["last_active"] = time.time()

        if to_stop:
            for w in to_stop:
                print(f" [i] تحرير خط الاشتراك من {w['key']} قبل تشغيل {stream_key}")
                self._signal_stop(w)
            # wait for the provider connection to be really closed (single-connection line)
            for w in to_stop:
                t = w.get("thread")
                if t and t.is_alive():
                    try:
                        t.join(timeout=3)
                    except Exception:
                        pass

        if starting:
            worker["thread"].start()

        deadline = time.time() + wait_seconds
        while time.time() < deadline:
            text = self._read_playlist(worker)
            if text:
                return stream_key, worker["session"], text
            if worker["stopped"].is_set():
                break
            time.sleep(0.25)
        return stream_key, worker["session"], self._read_playlist(worker)

    def touch(self, stream_key):
        with self.lock:
            w = self.workers.get(stream_key)
            if w:
                w["last_active"] = time.time()

    def segment_path(self, stream_key, session, filename):
        with self.lock:
            w = self.workers.get(stream_key)
            if w:
                w["last_active"] = time.time()
        path = os.path.join(self.base_dir, stream_key, session, filename)
        return path

    def stats(self):
        with self.lock:
            return {
                k: {
                    "session": w["session"],
                    "upstream_reconnects": w["reconnects"],
                    "ffmpeg_generations": w["generation"],
                    "replayed_packets_dropped": w["splicer"].dropped,
                    "idle_seconds": round(time.time() - w["last_active"], 1),
                }
                for k, w in self.workers.items()
            }

    # ------------------------------------------------------------------ internals
    def _new_worker(self, stream_key, upstream_url):
        session = uuid.uuid4().hex[:10]
        hls_dir = os.path.join(self.base_dir, stream_key, session)
        os.makedirs(hls_dir, exist_ok=True)
        worker = {
            "key": stream_key,
            "session": session,
            "hls_dir": hls_dir,
            "m3u8_path": os.path.join(hls_dir, "index.m3u8"),
            "upstream_url": upstream_url,
            "stopped": threading.Event(),
            "last_active": time.time(),
            "proc": None,
            "resp": None,
            "reconnects": 0,
            "generation": 0,
            "splicer": _TsSplicer(),
        }
        worker["thread"] = threading.Thread(target=self._run, args=(worker,), daemon=True)
        return worker

    def _signal_stop(self, w):
        w["stopped"].set()
        resp = w.get("resp")
        if resp is not None:
            try:
                resp.close()
            except Exception:
                pass
        proc = w.get("proc")
        if proc is not None:
            try:
                proc.stdin.close()
            except Exception:
                pass
            try:
                proc.terminate()
            except Exception:
                pass

    @staticmethod
    def _read_playlist(w):
        path = w["m3u8_path"]
        try:
            if os.path.exists(path) and os.path.getsize(path) > 20:
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
                if "#EXTINF" in text:
                    return text
        except Exception:
            pass
        return None

    def _start_ffmpeg(self, w):
        w["generation"] += 1
        gen = w["generation"]
        flags = "delete_segments+omit_endlist+temp_file+independent_segments"
        if gen > 1:
            flags += "+append_list"  # FFmpeg inserts #EXT-X-DISCONTINUITY automatically
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning",
            "-probesize", "131072", "-analyzeduration", "1000000",
            "-fflags", "+genpts+discardcorrupt",
            "-f", "mpegts", "-i", "pipe:0",
            "-map", "0:v?", "-map", "0:a?", "-sn", "-dn",
            "-c", "copy",
            "-f", "hls",
            "-hls_time", str(HLS_TIME),
            "-hls_list_size", str(HLS_LIST_SIZE),
            "-hls_delete_threshold", "4",
            "-hls_flags", flags,
            "-hls_segment_filename", os.path.join(w["hls_dir"], f"g{gen}_%06d.ts"),
            w["m3u8_path"],
        ]
        log_path = os.path.join(self.log_dir, f"{w['key']}.log")
        log_f = open(log_path, "ab")
        log_f.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} session={w['session']} gen={gen} =====\n".encode())
        log_f.flush()
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=log_f)
        log_f.close()
        w["proc"] = proc
        return proc

    def _open_upstream(self, url):
        req = urllib.request.Request(url, headers={
            "User-Agent": "VLC/3.0.18 LibVLC/3.0.18",
            "Accept": "*/*",
            "Connection": "keep-alive",
        })
        return urllib.request.urlopen(req, timeout=UPSTREAM_READ_TIMEOUT, context=SSL_CTX)

    def _run(self, w):
        key = w["key"]
        stopped = w["stopped"]
        splicer = w["splicer"]
        backoff = 0.3
        first_connect = True
        proc = None
        try:
            while not stopped.is_set():
                if time.time() - w["last_active"] > IDLE_TIMEOUT:
                    print(f" [i] لا يوجد مشاهد للقناة {key} منذ {IDLE_TIMEOUT} ثانية، إيقاف الجلسة.")
                    break

                if proc is None or proc.poll() is not None:
                    if proc is not None:
                        print(f" [!] FFmpeg توقف للقناة {key} (code={proc.returncode})، تشغيل جيل جديد.")
                    proc = self._start_ffmpeg(w)

                # ---- connect to provider
                try:
                    resp = self._open_upstream(w["upstream_url"])
                except Exception as e:
                    if stopped.is_set():
                        break
                    print(f" [↻] {key}: فشل الاتصال بالمصدر ({type(e).__name__}) إعادة المحاولة بعد {backoff:.1f}s")
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 3.0)
                    continue

                w["resp"] = resp
                if stopped.is_set():
                    break
                if first_connect:
                    print(f" [✓] بث متصل للقناة {key} (جلسة {w['session']})")
                    first_connect = False
                else:
                    w["reconnects"] += 1
                    splicer.on_reconnect()
                    print(f" [↻] {key}: أعيد الاتصال بالمصدر بسلاسة (#{w['reconnects']}) بدون إعادة تشغيل FFmpeg")

                # ---- pump provider -> ffmpeg
                got_data = False
                try:
                    while not stopped.is_set():
                        chunk = resp.read(64 * 1024)
                        if not chunk:
                            break
                        got_data = True
                        data = splicer.feed(chunk)
                        if data:
                            try:
                                proc.stdin.write(data)
                                proc.stdin.flush()
                            except (BrokenPipeError, OSError, ValueError):
                                proc = None if stopped.is_set() else proc
                                break
                        if time.time() - w["last_active"] > IDLE_TIMEOUT:
                            break
                except Exception:
                    pass
                finally:
                    try:
                        resp.close()
                    except Exception:
                        pass
                    w["resp"] = None

                backoff = 0.3 if got_data else min(backoff * 2, 3.0)
                if not stopped.is_set():
                    time.sleep(0.1 if got_data else backoff)
        finally:
            stopped.set()
            p = w.get("proc")
            if p is not None:
                try:
                    p.stdin.close()
                except Exception:
                    pass
                try:
                    p.terminate()
                    p.wait(timeout=3)
                except Exception:
                    try:
                        p.kill()
                    except Exception:
                        pass
            with self.lock:
                if self.workers.get(key) is w:  # never remove a newer session of the same channel
                    self.workers.pop(key, None)
            # delete only this session's own directory
            shutil.rmtree(w["hls_dir"], ignore_errors=True)
            parent = os.path.dirname(w["hls_dir"])
            try:
                if not os.listdir(parent):
                    os.rmdir(parent)
            except Exception:
                pass

    def _cleanup_loop(self):
        while True:
            time.sleep(15)
            now = time.time()
            stale = []
            with self.lock:
                for k, w in list(self.workers.items()):
                    if now - w["last_active"] > IDLE_TIMEOUT + 15:
                        stale.append(w)
            for w in stale:
                self._signal_stop(w)
            if self.maintenance_callback:
                try:
                    self.maintenance_callback()
                except Exception:
                    pass
