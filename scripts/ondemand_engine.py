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

تحديث مدير الخطوط (Line Pool) — سبب تقطيع beIN:
  - كل قنوات beIN وكل سيرفراتها على خط اشتراك واحد (MAC واحد). المحرك القديم كان
    يطفئ كل بث آخر على الخط عند طلب أي بث جديد → المشاهدون يقطعون بعضهم ذهاباً وإياباً.
  5. قاعدة ثابتة: لا يُطفأ أبداً بث عليه مشاهد نشط (طلب خلال آخر ACTIVE_VIEWER_WINDOW ثانية).
  6. كل سيرفرات نفس القناة تنضم لنفس الاتصال الشغال (اتصال واحد لكل قناة مهما كان السيرفر).
  7. سعة الخط من LINE_MAX_CONNECTIONS (افتراضياً 2 حسب الاشتراك)، وتنخفض تلقائياً إذا
     رفض المزود الاتصال الإضافي أو بدأ يطرد الاتصالات بعضها ببعض.
  8. عند امتلاء الخط بمشاهدين نشطين يُرفض الطلب الجديد بـ line_full بدل قطع أحد.
  9. القراءة من المزود والكتابة إلى FFmpeg في خيطين منفصلين بمخزن مؤقت.
 10. بعد إعادة الاتصال يُستأنف الفيديو من إطار مفتاحي (keyframe) لمنع تشوه الصورة.
 11. شرائح الجلسة المنتهية تبقى SEGMENT_GRACE_SECONDS قبل الحذف (لا 404 للمشغلات).
=============================================================================
"""

import os
import re
import sys
import ssl
import time
import uuid
import shutil
import hashlib
import threading
import subprocess
import collections
import urllib.error
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

# ---- Line pool settings
LINE_MAX_CONNECTIONS = max(1, int(os.environ.get("LINE_MAX_CONNECTIONS", "2")))
ACTIVE_VIEWER_WINDOW = 20       # بث طُلب خلال هذه المدة = عليه مشاهد، ممنوع إطفاؤه
STARTUP_GRACE = 20              # بث جديد يُعتبر سليماً خلال هذه المدة حتى لو لم ينتج شرائح بعد
UNHEALTHY_AFTER = 15            # لا تحديث لقائمة التشغيل لهذه المدة = بث معطل يمكن استبداله
START_WAIT_SECONDS = 12         # أقصى انتظار لأول قائمة تشغيل داخل طلب HTTP
SEGMENT_GRACE_SECONDS = 30      # بقاء شرائح الجلسة المنتهية قبل حذفها
CAP_RESET_SECONDS = 15 * 60     # إعادة سعة الخط للقيمة الافتراضية بعد هذه المدة
THRASH_RECONNECTS_PER_MIN = 6   # إعادات اتصال/دقيقة تدل على أن المزود يطرد الاتصالات
REJECT_STREAK_LIMIT = 4         # رفض متتالٍ من المزود لاتصال جديد = الخط لا يقبل المزيد
REJECT_HTTP_CODES = {401, 403, 429, 458, 509}
WRITE_BUFFER_MAX = 16 * 1024 * 1024
ALERT_COOLDOWN = 10 * 60


def _line_id(url: str):
    """Identifies a connection-limited subscription line (host + MAC). None = unlimited source."""
    if "mac=" not in url and "hey-ott.net" not in url:
        return None
    m = re.match(r"https?://([^/?#]+)", url)
    host = m.group(1).lower() if m else ""
    mm = re.search(r"mac=([0-9A-Fa-f:%]+)", url)
    mac = mm.group(1).upper() if mm else ""
    return f"{host}|{mac}"


def _line_label(line):
    """Public label for a line that never exposes the MAC address."""
    if not line:
        return "unlimited"
    host, _, mac = line.partition("|")
    return f"{host}#{hashlib.sha256(mac.encode()).hexdigest()[:6]}"


def _is_single_connection_line(url: str) -> bool:
    return _line_id(url) is not None


def _parse_packet(pkt: bytes, offset: int):
    """Returns (pid, pusi, pts|None, is_video, random_access) for a TS packet at offset."""
    b1 = pkt[offset + 1]
    pid = ((b1 & 0x1F) << 8) | pkt[offset + 2]
    pusi = bool(b1 & 0x40)
    afc = (pkt[offset + 3] >> 4) & 0x03
    rai = False
    p = offset + 4
    if afc in (2, 3):
        af_len = pkt[offset + 4]
        if af_len > 0:
            rai = bool(pkt[offset + 5] & 0x40)
        p += 1 + af_len
    if not pusi or afc == 2:
        return pid, pusi, None, False, rai
    end = offset + TS_PACKET
    if p + 14 > end:
        return pid, True, None, False, rai
    if pkt[p] != 0 or pkt[p + 1] != 0 or pkt[p + 2] != 1:
        return pid, True, None, False, rai  # PSI table (PAT/PMT) – not a PES
    stream_id = pkt[p + 3]
    is_video = 0xE0 <= stream_id <= 0xEF
    if not (0xC0 <= stream_id <= 0xEF or stream_id == 0xBD):
        return pid, True, None, False, rai
    if not (pkt[p + 7] & 0x80):
        return pid, True, None, is_video, rai
    q = p + 9
    pts = (((pkt[q] >> 1) & 0x07) << 30) | (pkt[q + 1] << 22) | ((pkt[q + 2] >> 1) << 15) | (pkt[q + 3] << 7) | (pkt[q + 4] >> 1)
    return pid, True, pts, is_video, rai


def _pts_is_newer(pts: int, last: int) -> bool:
    diff = (pts - last) % PTS_WRAP
    if diff == 0:
        return False
    if diff < PTS_WRAP // 2:
        return True  # forward (handles 33-bit wrap)
    # backwards: only accept if it is a huge jump (encoder restart on provider side)
    return (last - pts) % PTS_WRAP > PTS_RESYNC_WINDOW


class _TsSplicer:
    """Keeps TS packet alignment, removes replayed packets after a reconnect and resumes video on a keyframe."""

    def __init__(self):
        self.remainder = b""
        self.synced = False
        self.last_pts = {}       # pid -> last forwarded PTS
        self.gated = set()       # pids waiting for PTS > last_pts after reconnect
        self.await_key = set()   # video pids waiting for a keyframe
        self.video_pids = set()
        self.rai_seen = set()    # video pids whose encoder marks keyframes (random_access_indicator)
        self.dropped = 0

    def on_reconnect(self):
        self.remainder = b""
        self.synced = False
        self.gated = set(self.last_pts.keys())
        self.await_key = set()

    def require_keyframe(self):
        """Used when a new FFmpeg generation starts mid-stream."""
        self.await_key = set(self.video_pids & self.rai_seen)

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
        await_key = self.await_key
        last_pts = self.last_pts
        for off in range(0, usable, TS_PACKET):
            if buf[off] != SYNC_BYTE:
                # lost sync mid-chunk: resync on next feed
                self.synced = False
                self.remainder = buf[off:]
                break
            pid, pusi, pts, is_video, rai = _parse_packet(buf, off)
            if is_video:
                self.video_pids.add(pid)
            if rai and pusi and pid in self.video_pids:
                self.rai_seen.add(pid)

            if pid in gated:
                if pts is None:
                    # continuation of a replayed PES, or PES start without PTS while gated
                    self.dropped += 1
                    continue
                prev = last_pts.get(pid)
                if prev is not None and not _pts_is_newer(pts, prev):
                    self.dropped += 1
                    continue
                gated.discard(pid)
                if pid in self.rai_seen and not rai:
                    await_key.add(pid)

            if pid in await_key:
                if not (pusi and rai):
                    self.dropped += 1
                    continue
                await_key.discard(pid)

            if pts is not None:
                last_pts[pid] = pts
            out += buf[off:off + TS_PACKET]
        return bytes(out)


class _WriteBuffer:
    """Bounded FIFO between the upstream reader and the FFmpeg writer (chunks are TS-aligned)."""

    def __init__(self, max_bytes=WRITE_BUFFER_MAX):
        self.q = collections.deque()
        self.bytes = 0
        self.max_bytes = max_bytes
        self.cv = threading.Condition()
        self.closed = False
        self.overflow_drops = 0

    def put(self, data: bytes):
        with self.cv:
            if self.closed:
                return
            self.q.append(data)
            self.bytes += len(data)
            while self.bytes > self.max_bytes and len(self.q) > 1:
                old = self.q.popleft()
                self.bytes -= len(old)
                self.overflow_drops += 1
            self.cv.notify()

    def get(self, timeout=1.0):
        """Returns bytes, b"" on timeout, or None once closed and drained."""
        with self.cv:
            if not self.q and not self.closed:
                self.cv.wait(timeout)
            if self.q:
                data = self.q.popleft()
                self.bytes -= len(data)
                return data
            return None if self.closed else b""

    def close(self):
        with self.cv:
            self.closed = True
            self.cv.notify_all()


class OnDemandStreamManager:
    def __init__(self, base_dir, maintenance_callback=None, alert_callback=None):
        self.base_dir = base_dir
        self.workers = {}   # stream_key -> worker dict
        self.lock = threading.Lock()
        self.maintenance_callback = maintenance_callback
        self.alert_callback = alert_callback
        self.line_caps = {}             # line -> (cap, set_at)
        self.events = collections.deque(maxlen=200)
        self.pending_deletes = []       # (path, delete_at)
        self.last_alert = {}            # kind -> ts
        self.log_dir = os.path.join(base_dir, "_logs")
        os.makedirs(self.log_dir, exist_ok=True)
        # Remove leftovers of previous runs (old names would collide with nothing now, but free disk)
        for name in os.listdir(base_dir):
            if name != "_logs":
                shutil.rmtree(os.path.join(base_dir, name), ignore_errors=True)
        threading.Thread(target=self._cleanup_loop, daemon=True).start()

    # ------------------------------------------------------------------ public API
    def get_or_start_stream(self, cid, server_id, upstream_url, wait_seconds=START_WAIT_SECONDS):
        """Returns (stream_key, session_id, playlist_text|None, status).

        status: "ok" (playlist ready), "starting" (not ready yet) or "line_full"
        (every connection of the subscription line is used by active viewers).
        The returned stream_key may belong to another server of the same channel
        when that stream is already running on the line (shared connection).
        """
        requested_key = f"{cid}_s{server_id}"
        line = _line_id(upstream_url)
        to_stop = []
        starting = False
        refused = False
        worker = None
        with self.lock:
            now = time.time()
            worker = self.workers.get(requested_key)
            if worker and (worker["stopped"].is_set() or worker["upstream_url"] != upstream_url):
                to_stop.append(self.workers.pop(requested_key))
                worker = None
            if worker is not None and line and not self._is_healthy(worker, now):
                # requested server itself is broken: rebuild it
                to_stop.append(self.workers.pop(requested_key))
                self._event("replace_unhealthy", worker["key"])
                worker = None

            if worker is None and line:
                same_channel = [w for w in self._line_workers(line) if w["cid"] == cid]
                healthy = [w for w in same_channel if self._is_healthy(w, now)]
                if healthy:
                    worker = healthy[0]  # share the running connection of this channel
                else:
                    for w in same_channel:
                        to_stop.append(self.workers.pop(w["key"]))
                        self._event("replace_unhealthy", w["key"])
                    active = self._line_workers(line)
                    cap = self._line_cap(line, now)
                    if len(active) >= cap:
                        idle = sorted(
                            (w for w in active if now - w["last_active"] > ACTIVE_VIEWER_WINDOW),
                            key=lambda w: w["last_active"],
                        )
                        need = len(active) - cap + 1
                        if len(idle) >= need:
                            for w in idle[:need]:
                                to_stop.append(self.workers.pop(w["key"]))
                                self._event("evict_idle", w["key"], f"for {requested_key}")
                        else:
                            refused = True

            if worker is None and not refused:
                worker = self._new_worker(requested_key, cid, upstream_url, line)
                self.workers[requested_key] = worker
                starting = True
            if worker is not None:
                worker["last_active"] = now
            line_snapshot = [w["key"] for w in self._line_workers(line)] if line else []

        if to_stop:
            for w in to_stop:
                print(f" [i] تحرير اتصال {w['key']} (بدون مشاهدين أو معطل)")
                self._signal_stop(w)
            # wait until the provider connection is really closed (connection-limited line)
            for w in to_stop:
                closed = w.get("upstream_closed")
                if closed is not None:
                    closed.wait(timeout=3)

        if refused:
            self._event("line_full", requested_key, f"busy: {', '.join(line_snapshot)}")
            print(f" [!] الخط ممتلئ: رفض {requested_key} لأن كل الاتصالات عليها مشاهدون ({', '.join(line_snapshot)})")
            self._alert(
                "line_full",
                "⚠️ <b>خط الاشتراك ممتلئ</b>\n"
                f"طلب جديد: <code>{requested_key}</code>\n"
                f"القنوات الشغالة: <code>{', '.join(line_snapshot)}</code>\n"
                "لم يُقطع أي مشاهد. لزيادة القنوات المتزامنة أضف خطاً جديداً.",
            )
            return None, None, None, "line_full"

        if starting:
            self._event("start", requested_key)
            worker["thread"].start()

        deadline = time.time() + wait_seconds
        while time.time() < deadline:
            text = self._read_playlist(worker)
            if text:
                return worker["key"], worker["session"], text, "ok"
            if worker["stopped"].is_set():
                break
            time.sleep(0.25)
        text = self._read_playlist(worker)
        return worker["key"], worker["session"], text, ("ok" if text else "starting")

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
        now = time.time()
        with self.lock:
            lines = {}
            for w in self.workers.values():
                if w["line"]:
                    lbl = _line_label(w["line"])
                    entry = lines.setdefault(lbl, {"capacity": self._line_cap(w["line"], now), "streams": []})
                    entry["streams"].append(w["key"])
            return {
                "line_max_connections": LINE_MAX_CONNECTIONS,
                "lines": lines,
                "streams": {
                    k: {
                        "channel": w["cid"],
                        "line": _line_label(w["line"]),
                        "session": w["session"],
                        "age_seconds": round(now - w["created"], 1),
                        "idle_seconds": round(now - w["last_active"], 1),
                        "has_active_viewers": now - w["last_active"] <= ACTIVE_VIEWER_WINDOW,
                        "healthy": self._is_healthy(w, now),
                        "upstream_reconnects": w["reconnects"],
                        "reconnects_last_minute": len(w["reconnect_times"]),
                        "ffmpeg_generations": w["generation"],
                        "replayed_packets_dropped": w["splicer"].dropped,
                        "buffer_overflow_drops": w["buffer"].overflow_drops,
                    }
                    for k, w in self.workers.items()
                },
                "events": list(self.events)[-50:],
            }

    # ------------------------------------------------------------------ line pool internals (call with lock held)
    def _line_workers(self, line):
        return [w for w in self.workers.values() if w["line"] == line and not w["stopped"].is_set()]

    def _line_cap(self, line, now):
        entry = self.line_caps.get(line)
        if entry and now - entry[1] < CAP_RESET_SECONDS:
            return entry[0]
        return LINE_MAX_CONNECTIONS

    def _is_healthy(self, w, now):
        if w["stopped"].is_set():
            return False
        try:
            mtime = os.path.getmtime(w["m3u8_path"])
        except OSError:
            return now - w["created"] < STARTUP_GRACE
        return now - mtime < UNHEALTHY_AFTER

    def _event(self, kind, key, detail=""):
        self.events.append({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "event": kind, "stream": key, "detail": detail})

    # ------------------------------------------------------------------ line pool feedback from workers
    def _line_has_others(self, w):
        with self.lock:
            return any(o is not w for o in self._line_workers(w["line"]))

    def _on_line_rejected(self, w, reason):
        """Provider refuses an extra connection: lower the line capacity to what it really accepts."""
        with self.lock:
            others = [o for o in self._line_workers(w["line"]) if o is not w]
            cap = max(1, len(others))
            self.line_caps[w["line"]] = (cap, time.time())
            self._event("line_rejected", w["key"], f"{reason}; capacity -> {cap}")
        print(f" [!] المزود رفض اتصالاً إضافياً ({reason})، سعة الخط أصبحت {cap}")
        self._alert("line_rejected", f"⚠️ المزود رفض اتصالاً إضافياً ({reason}). سعة الخط خُفضت إلى {cap} مؤقتاً.")

    def _on_line_thrash(self, w):
        """Provider keeps kicking connections (more than allowed are open). Returns True if w must stop."""
        with self.lock:
            active = self._line_workers(w["line"])
            if len(active) < 2:
                return False
            cap = max(1, len(active) - 1)
            self.line_caps[w["line"]] = (cap, time.time())
            victim = max(active, key=lambda o: o["created"])  # newest stream yields
            self._event("line_thrash", victim["key"], f"capacity -> {cap}")
        print(f" [!] المزود يطرد الاتصالات (إعادات اتصال متكررة)، إيقاف {victim['key']} وسعة الخط أصبحت {cap}")
        self._alert("line_thrash", f"⚠️ المزود يطرد الاتصالات المتزامنة. سعة الخط خُفضت إلى {cap} مؤقتاً.")
        if victim is w:
            return True
        self._signal_stop(victim)
        return False

    def _alert(self, kind, text):
        if not self.alert_callback:
            return
        now = time.time()
        if now - self.last_alert.get(kind, 0) < ALERT_COOLDOWN:
            return
        self.last_alert[kind] = now
        try:
            self.alert_callback(text)
        except Exception:
            pass

    # ------------------------------------------------------------------ worker internals
    def _new_worker(self, stream_key, cid, upstream_url, line):
        session = uuid.uuid4().hex[:10]
        hls_dir = os.path.join(self.base_dir, stream_key, session)
        os.makedirs(hls_dir, exist_ok=True)
        worker = {
            "key": stream_key,
            "cid": cid,
            "line": line,
            "session": session,
            "hls_dir": hls_dir,
            "m3u8_path": os.path.join(hls_dir, "index.m3u8"),
            "upstream_url": upstream_url,
            "stopped": threading.Event(),
            "upstream_closed": threading.Event(),
            "created": time.time(),
            "last_active": time.time(),
            "proc": None,
            "resp": None,
            "reconnects": 0,
            "reconnect_times": collections.deque(),
            "generation": 0,
            "need_key": False,
            "ever_connected": False,
            "splicer": _TsSplicer(),
            "buffer": _WriteBuffer(),
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
        w["buffer"].close()
        if not w["thread"].is_alive():
            w["upstream_closed"].set()

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
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=log_f, bufsize=0)
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

    def _writer(self, w):
        """Owns the FFmpeg process: writes buffered TS data and restarts FFmpeg if it ever dies."""
        buf = w["buffer"]
        proc = None
        try:
            while True:
                data = buf.get(timeout=1.0)
                if data is None:
                    break
                if not data:
                    continue
                if proc is None or proc.poll() is not None:
                    if proc is not None:
                        print(f" [!] FFmpeg توقف للقناة {w['key']} (code={proc.returncode})، تشغيل جيل جديد.")
                    proc = self._start_ffmpeg(w)
                    if w["generation"] > 1:
                        w["need_key"] = True
                try:
                    proc.stdin.write(data)
                except (BrokenPipeError, OSError, ValueError):
                    proc = None
        finally:
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

    def _run(self, w):
        key = w["key"]
        stopped = w["stopped"]
        splicer = w["splicer"]
        buf = w["buffer"]
        backoff = 0.3
        reject_streak = 0
        writer = threading.Thread(target=self._writer, args=(w,), daemon=True)
        writer.start()
        try:
            while not stopped.is_set():
                if time.time() - w["last_active"] > IDLE_TIMEOUT:
                    print(f" [i] لا يوجد مشاهد للقناة {key} منذ {IDLE_TIMEOUT} ثانية، إيقاف الجلسة.")
                    break

                # ---- connect to provider
                try:
                    resp = self._open_upstream(w["upstream_url"])
                except Exception as e:
                    if stopped.is_set():
                        break
                    code = getattr(e, "code", None) if isinstance(e, urllib.error.HTTPError) else None
                    if code in REJECT_HTTP_CODES and w["line"]:
                        reject_streak += 1
                        if not w["ever_connected"] and reject_streak >= REJECT_STREAK_LIMIT and self._line_has_others(w):
                            self._on_line_rejected(w, f"HTTP {code}")
                            break
                    label = f"HTTP {code}" if code else type(e).__name__
                    print(f" [↻] {key}: فشل الاتصال بالمصدر ({label}) إعادة المحاولة بعد {backoff:.1f}s")
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 3.0)
                    continue

                reject_streak = 0
                w["resp"] = resp
                if stopped.is_set():
                    break
                if not w["ever_connected"]:
                    w["ever_connected"] = True
                    print(f" [✓] بث متصل للقناة {key} (جلسة {w['session']})")
                else:
                    w["reconnects"] += 1
                    now = time.time()
                    times = w["reconnect_times"]
                    times.append(now)
                    while times and now - times[0] > 60:
                        times.popleft()
                    splicer.on_reconnect()
                    print(f" [↻] {key}: أعيد الاتصال بالمصدر بسلاسة (#{w['reconnects']}) بدون إعادة تشغيل FFmpeg")
                    if w["line"] and len(times) >= THRASH_RECONNECTS_PER_MIN and self._line_has_others(w):
                        if self._on_line_thrash(w):
                            break
                        times.clear()

                # ---- pump provider -> buffer (FFmpeg writer runs in its own thread)
                got_data = False
                try:
                    while not stopped.is_set():
                        if w["need_key"]:
                            w["need_key"] = False
                            splicer.require_keyframe()
                        chunk = resp.read(64 * 1024)
                        if not chunk:
                            break
                        got_data = True
                        data = splicer.feed(chunk)
                        if data:
                            buf.put(data)
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
            resp = w.get("resp")
            if resp is not None:
                try:
                    resp.close()
                except Exception:
                    pass
            w["upstream_closed"].set()
            buf.close()
            writer.join(timeout=6)
            with self.lock:
                if self.workers.get(key) is w:  # never remove a newer session of the same channel
                    self.workers.pop(key, None)
                # keep this session's segments for a while so players never hit 404
                self.pending_deletes.append((w["hls_dir"], time.time() + SEGMENT_GRACE_SECONDS))
            self._event("stop", key)

    def _cleanup_loop(self):
        while True:
            time.sleep(15)
            now = time.time()
            stale = []
            due = []
            with self.lock:
                for k, w in list(self.workers.items()):
                    if now - w["last_active"] > IDLE_TIMEOUT + 15:
                        stale.append(w)
                keep = []
                for path, at in self.pending_deletes:
                    (due if now >= at else keep).append((path, at))
                self.pending_deletes = keep
            for w in stale:
                self._signal_stop(w)
            for path, _ in due:
                # delete only this session's own directory
                shutil.rmtree(path, ignore_errors=True)
                parent = os.path.dirname(path)
                try:
                    if not os.listdir(parent):
                        os.rmdir(parent)
                except Exception:
                    pass
            if self.maintenance_callback:
                try:
                    self.maintenance_callback()
                except Exception:
                    pass
