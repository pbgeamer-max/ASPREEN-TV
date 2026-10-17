# -*- coding: utf-8 -*-
"""
=============================================================================
         ASPREEN TV ▸ 24/7 PERSISTENT STREAM PROXY & AUTO-RENEW DAEMON
    خادم وسكربت البث الدائم على مدار 24 ساعة بدون انقطاع وتحديث الروابط تلقائياً
=============================================================================
* يقوم بإعادة بث القنوات عبر خادم بروكسي محلي (Port 8080).
* المشاهد يشاهد رابط موقعك الثابت: http://localhost:8080/live/{id}.m3u8
* السكربت يجدد التوكن وروابط البث في الخلفية كل 30 دقيقة بدون أن يشعر المشاهد أو ينقطع البث.
* يدعم بوت تيليجرام لإرسال تقارير دورية وحالة الخادم.
* يعمل على مدار 24 ساعة بصمت تام دون الحاجة لأي تدخل يدوي.
=============================================================================
"""

import os
import sys
import re
import json
import time
import base64
import socket
import threading
import subprocess
import shutil
import ssl
import urllib.request
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Unverified SSL context for upstream IPTV streams with self-signed or expired certs
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

class HeaderPreservingRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Preserve original headers (User-Agent, Referer, X-Forwarded-For, etc.) across 302 redirects
        new_headers = dict(req.headers)
        return urllib.request.Request(newurl, headers=new_headers)

PROXY_OPENER = urllib.request.build_opener(
    HeaderPreservingRedirectHandler,
    urllib.request.HTTPSHandler(context=SSL_CTX)
)

# Ensure UTF-8 and line-buffered output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)


WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DESKTOP_DIR = os.path.join(os.path.expanduser("~"), "Desktop")
DATA_DIR = os.path.join(WORKSPACE_DIR, "data")
CONFIG_FILE = os.path.join(WORKSPACE_DIR, "telegram_config.json")
CHANNELS_JSON_PATH = os.path.join(WORKSPACE_DIR, "channels.json")

PORT = int(os.environ.get("STREAM_PROXY_PORT", os.environ.get("PORT", "8088")))
AUTO_RENEW_INTERVAL_SECONDS = 15 * 60  # Renew every 15 minutes
TELEGRAM_HEARTBEAT_HOURS = 12          # Telegram report every 12 hours


# Load Telegram Config
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_ADMIN_CHAT_ID = os.getenv("TELEGRAM_ADMIN_CHAT_ID", "")

if os.path.exists(CONFIG_FILE):
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            TELEGRAM_BOT_TOKEN = cfg.get("bot_token", TELEGRAM_BOT_TOKEN)
            TELEGRAM_ADMIN_CHAT_ID = cfg.get("admin_chat_id", TELEGRAM_ADMIN_CHAT_ID)
    except Exception:
        pass

DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"

# Geo-Bypass Headers
BYPASS_HEADERS = {
    "User-Agent": DEFAULT_UA,
    "Referer": "https://yacine.website/",
    "X-Forwarded-For": "156.200.1.1",  # Egypt/Algeria IP bypass
    "Accept": "*/*"
}

# Global In-Memory State
channels_cache = {}  # cid -> channel dict
channel_max_sequence = {}  # cid -> highest seen media sequence to prevent backwards jumps
cache_lock = threading.Lock()
server_start_time = time.time()
last_renew_time = 0
total_refreshes = 0

# Direct 24/7 Pure Stream Configuration (Zero transcoding / Zero CPU / 100% stable)

# -----------------------------------------------------------------------------
# On-Demand HLS Stream Manager (Multi-User Stream Fanout / Relay Engine)
# يحول رابط البث (TS) إلى شرائح HLS لحظياً بدون أي استهلاك للمعالج (-c copy)
# يتصل بالسيرفر الأصلي باتصال واحد فقط، ويوزع البث على آلاف المستخدمين في موقعك
# -----------------------------------------------------------------------------
HLS_STORAGE_PATH = os.environ.get("STREAM_STORAGE_PATH", os.path.join(DATA_DIR, "hls"))
HLS_ONDEMAND_DIR = os.path.join(HLS_STORAGE_PATH, "ondemand")
os.makedirs(HLS_ONDEMAND_DIR, exist_ok=True)

# In-memory hot segment cache for instant 0ms responses across all viewers
HOT_SEGMENT_CACHE = {}  # key -> (bytes_data, expires_at)
hot_cache_lock = threading.Lock()

class OnDemandStreamManager:
    def __init__(self, base_dir):
        self.base_dir = base_dir
        self.workers = {}  # stream_key -> {"proc": Popen, "hls_dir": str, "m3u8_path": str, "last_active": float, "upstream_url": str}
        self.lock = threading.Lock()
        os.makedirs(self.base_dir, exist_ok=True)
        self.cleaner_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self.cleaner_thread.start()

    def get_or_start_stream(self, cid, server_id, upstream_url):
        stream_key = f"{cid}_s{server_id}"
        with self.lock:
            worker = self.workers.get(stream_key)
            if worker and worker["proc"].poll() is None:
                worker["last_active"] = time.time()
                m3u8_path = worker["m3u8_path"]
            else:
                hls_dir = os.path.join(self.base_dir, stream_key)
                if os.path.exists(hls_dir):
                    shutil.rmtree(hls_dir, ignore_errors=True)
                os.makedirs(hls_dir, exist_ok=True)
                m3u8_path = os.path.join(hls_dir, "index.m3u8")

                cmd = [
                    "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning",
                    "-re",
                    "-fflags", "+genpts+nobuffer+flush_packets",
                    "-avoid_negative_ts", "make_zero",
                    "-i", "pipe:0",
                    "-c", "copy",
                    "-f", "hls",
                    "-hls_time", "2",
                    "-hls_list_size", "30",
                    "-hls_delete_threshold", "20",
                    "-hls_flags", "delete_segments+append_list",
                    m3u8_path
                ]
                try:
                    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    stop_event = threading.Event()

                    def feeder_loop(p, u, stop_ev, sk):
                        headers = {"User-Agent": "VLC/3.0.18 LibVLC/3.0.18", "Connection": "keep-alive"}
                        while not stop_ev.is_set():
                            try:
                                req = urllib.request.Request(u, headers=headers)
                                with PROXY_OPENER.open(req, timeout=12) as resp:
                                    while not stop_ev.is_set():
                                        chunk = resp.read(32 * 1024)
                                        if not chunk:
                                            # Upstream closed connection (~45s limit), loop immediately to reconnect seamlessly
                                            break
                                        try:
                                            p.stdin.write(chunk)
                                            p.stdin.flush()
                                        except (BrokenPipeError, OSError):
                                            return
                                time.sleep(0.1)
                            except Exception:
                                time.sleep(0.3)

                    t_feed = threading.Thread(target=feeder_loop, args=(proc, upstream_url, stop_event, stream_key), daemon=True)
                    t_feed.start()

                    self.workers[stream_key] = {
                        "proc": proc,
                        "hls_dir": hls_dir,
                        "m3u8_path": m3u8_path,
                        "last_active": time.time(),
                        "upstream_url": upstream_url,
                        "stop_event": stop_event,
                        "feeder_thread": t_feed
                    }
                    print(f" [✓] تشغيل موزع البث الحصري للقناة {stream_key} (اتصال واحد دائم ومشاركة لآلاف الزوار)")
                except Exception as e:
                    print(f" [!] خطأ في تشغيل محرك تحويل البث On-Demand: {e}")
                    return None, None

        # Wait up to 8.0 seconds for first manifest
        for _ in range(32):
            if os.path.exists(m3u8_path) and os.path.getsize(m3u8_path) > 20:
                try:
                    with open(m3u8_path, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                    if "#EXTINF" in content:
                        return stream_key, content
                except Exception:
                    pass
            time.sleep(0.25)

        if os.path.exists(m3u8_path):
            try:
                with open(m3u8_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                return stream_key, content
            except Exception:
                pass
        return stream_key, None

    def touch(self, stream_key):
        with self.lock:
            if stream_key in self.workers:
                self.workers[stream_key]["last_active"] = time.time()

    def _cleanup_loop(self):
        while True:
            time.sleep(15)
            now = time.time()
            to_stop = []
            with self.lock:
                for sk, w in list(self.workers.items()):
                    if w["proc"].poll() is not None:
                        to_stop.append((sk, f"توقف FFmpeg (كود: {w['proc'].poll()})"))
                    elif (now - w.get("last_active", now)) > 120:
                        to_stop.append((sk, "120 ثانية خمول بدون مشاهدين"))

            for sk, reason in to_stop:
                with self.lock:
                    worker = self.workers.pop(sk, None)
                if worker:
                    worker.get("stop_event", threading.Event()).set()
                    try:
                        worker["proc"].stdin.close()
                    except Exception:
                        pass
                    try:
                        worker["proc"].terminate()
                        worker["proc"].wait(timeout=2)
                    except Exception:
                        try:
                            worker["proc"].kill()
                        except Exception:
                            pass
                    # Only wipe files if inactive for 120s, preserve on crash so viewers don't 404
                    if (now - worker.get("last_active", now)) >= 120:
                        shutil.rmtree(worker["hls_dir"], ignore_errors=True)
                    print(f" [i] إيقاف جلسة البث On-Demand للقناة {sk} ({reason}).")

            # Prune hot in-memory segment cache
            with hot_cache_lock:
                expired = [k for k, v in HOT_SEGMENT_CACHE.items() if now > v[1]]
                for k in expired:
                    HOT_SEGMENT_CACHE.pop(k, None)

ON_DEMAND_STREAM_MANAGER = OnDemandStreamManager(HLS_ONDEMAND_DIR)


def send_telegram_message(text: str):
    """Sends text notification to Telegram admin"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_ADMIN_CHAT_ID:
        return False
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = json.dumps({
            "chat_id": TELEGRAM_ADMIN_CHAT_ID,
            "text": text,
            "parse_mode": "HTML"
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.getcode() == 200
    except Exception as e:
        print(f" [!] خطأ في إرسال إشعار تيليجرام: {e}")
        return False


def load_channels_from_disk():
    """Loads existing channels.json into memory"""
    global channels_cache
    if os.path.exists(CHANNELS_JSON_PATH):
        try:
            with open(CHANNELS_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            now = time.time()
            with cache_lock:
                for ch in data:
                    cid = str(ch.get("id") or ch.get("vid"))
                    if not ch.get("lastRenewed"):
                        ch["lastRenewed"] = now
                    channels_cache[cid] = ch
            print(f" [✓] تم تحميل {len(channels_cache)} قناة في الذاكرة الحية.")
        except Exception as e:
            print(f" [!] خطأ في قراءة ملف channels.json: {e}")


def renew_single_channel_stream(cid):
    """Fetches a fresh stream URL for a single channel from upstream API"""
    api_url = f"https://yacine.website/index.php?get_channel_stream={cid}"
    headers = dict(BYPASS_HEADERS)
    with cache_lock:
        ch = channels_cache.get(cid, {})
        name = ch.get("name", "live")
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-') or 'live'
    headers["Referer"] = f"https://yacine.website/channel/{cid}/{slug}"

    req = urllib.request.Request(api_url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10, context=SSL_CTX) as r:
            data = json.loads(r.read().decode("utf-8", errors="ignore"))
            if data.get("status") == "success":
                raw_url = data.get("raw_url", "").strip()
                play_url = data.get("url", "").strip()
                ua = data.get("user_agent", "")

                with cache_lock:
                    if cid in channels_cache:
                        ch = channels_cache[cid]
                        if play_url:
                            ch["playUrl"] = play_url if play_url.startswith("http") else f"https://yacine.website{play_url}"
                        if raw_url:
                            ch["streamUrl"] = raw_url
                            ch["directM3u8"] = raw_url
                        ch["userAgent"] = ua or DEFAULT_UA
                        ch["status"] = "live"
                        ch["source"] = "yacine.website"
                        ch["referer"] = f"https://yacine.website/channel/{cid}/live"
                        ch["lastRenewed"] = time.time()
                return True
            else:
                msg = data.get("message", "القناة غير متوفرة حالياً من المصدر")
                with cache_lock:
                    if cid in channels_cache:
                        channels_cache[cid]["status"] = "event_only"
                        channels_cache[cid]["status_message"] = msg
        return False
    except Exception:
        return False



m3u8_cache = {}  # cid -> (content_bytes, expire_timestamp)
m3u8_cache_lock = threading.Lock()

def background_auto_renew_loop():
    """24/7 Background thread that renews active channels periodically with gentle pacing"""
    global last_renew_time, total_refreshes
    time.sleep(15)  # Wait 15s for server startup

    while True:
        try:
            now = time.time()
            with cache_lock:
                primary_sports = {"207119423132628321", "207119423133708072", "207119423130423959", "207119423131118230"}
                cids_to_renew = [
                    cid for cid, ch in channels_cache.items()
                    if (ch.get("lastRenewed", 0) > (now - 3600) or cid in primary_sports)
                    and "edgenextcdn.net" not in ch.get("streamUrl", "")
                ]

            success_count = 0
            for cid in cids_to_renew:
                if renew_single_channel_stream(cid):
                    success_count += 1
                time.sleep(1.5)  # 1.5s gentle delay prevents Yacine Cloudflare IP rate-limiting

            last_renew_time = time.time()
            total_refreshes += 1

            # Update channels.json and channels.m3u
            save_channels_to_disk()

        except Exception as e:
            print(f" [!] استثناء في جولة التجديد: {e}")

        # Sleep until next round
        time.sleep(AUTO_RENEW_INTERVAL_SECONDS)


def telegram_heartbeat_loop():
    """Sends periodic Telegram status reports every X hours"""
    time.sleep(60)
    while True:
        try:
            uptime_hours = round((time.time() - server_start_time) / 3600, 1)
            with cache_lock:
                total_ch = len(channels_cache)
                live_ch = sum(1 for c in channels_cache.values() if c.get("status") == "live")

            msg = (
                "🟢 <b>تقرير نبض البث المباشر (24/7 Heartbeat):</b>\n\n"
                f"📡 <b>حالة السيرفر:</b> متصل ويعمل بثبات بدون توقف\n"
                f"⏱️ <b>مدة التشغيل المتواصل:</b> {uptime_hours} ساعة\n"
                f"📺 <b>إجمالي القنوات:</b> {total_ch} قناة\n"
                f"🟢 <b>القنوات النشطة:</b> {live_ch} قناة\n"
                f"🔄 <b>جولات التجديد التلقائي:</b> {total_refreshes} جولة\n"
                f"🕒 <b>التوقيت الحالي:</b> {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
                "🛡️ <i>البث مستمر 24 ساعة عبر البروكسي الداخلي لموقعك.</i>"
            )
            send_telegram_message(msg)
        except Exception:
            pass

        time.sleep(TELEGRAM_HEARTBEAT_HOURS * 3600)


def save_channels_to_disk():
    """Exports updated in-memory channels to channels.json and channels.m3u"""
    with cache_lock:
        channels_list = list(channels_cache.values())
        channels_list.sort(key=lambda x: x.get("orderIndex", 0))

    try:
        # 1. Update channels.json
        with open(CHANNELS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(channels_list, f, ensure_ascii=False, indent=2)

        # 2. Update channels.m3u pointing to local persistent proxy
        m3u_lines = ["#EXTM3U"]
        for ch in channels_list:
            cid = ch.get("id") or ch.get("vid")
            name = ch.get("name", "Channel").replace('"', "'")
            group = ch.get("groupTitle", "Live TV").replace('"', "'")
            logo = ch.get("logoUrl", "")
            proxy_stream_url = f"http://127.0.0.1:{PORT}/live/{cid}.m3u8"

            extinf = f'#EXTINF:-1 tvg-id="{cid}" tvg-name="{name}" tvg-logo="{logo}" group-title="{group}",{name}'
            m3u_lines.append(extinf)
            m3u_lines.append(proxy_stream_url)

        m3u_content = "\n".join(m3u_lines) + "\n"

        root_m3u = os.path.join(WORKSPACE_DIR, "channels.m3u")
        root_m3u8 = os.path.join(WORKSPACE_DIR, "channels.m3u8")
        desktop_m3u = os.path.join(DESKTOP_DIR, "channels.m3u")

        with open(root_m3u, "w", encoding="utf-8") as f:
            f.write(m3u_content)
        with open(root_m3u8, "w", encoding="utf-8") as f:
            f.write(m3u_content)

        if os.path.exists(DESKTOP_DIR):
            with open(desktop_m3u, "w", encoding="utf-8") as f:
                f.write(m3u_content)
    except Exception as e:
        print(f" [!] خطأ في حفظ الملفات: {e}")


class StreamProxyHTTPHandler(BaseHTTPRequestHandler):
    """High-speed HTTP Request Handler for 24/7 Live Stream Proxying"""

    def log_message(self, format, *args):
        # Silent logging to avoid console spamming on every TS segment
        return

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # 1. Health & Status endpoint
        if path == "/status" or path == "/":
            uptime = round(time.time() - server_start_time, 1)
            resp = {
                "server": "ASPREEN TV 24/7 Stream Proxy",
                "status": "ONLINE",
                "uptime_seconds": uptime,
                "total_channels": len(channels_cache),
                "last_renew_time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(last_renew_time)) if last_renew_time else "Starting",
                "total_auto_renews": total_refreshes
            }
            body = json.dumps(resp, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 2. Master Dynamic Playlist (all channels)
        if path == "/playlist.m3u" or path == "/channels.m3u":
            host = self.headers.get("X-Forwarded-Host", self.headers.get("Host", f"127.0.0.1:{PORT}"))
            if "127.0.0.1" in host or "localhost" in host:
                host = "aspreen-tv-production.up.railway.app"
            proto = self.headers.get("X-Forwarded-Proto", "https" if ("railway" in host or "443" in host) else "http")
            if "railway" in host:
                proto = "https"
            base_origin = f"{proto}://{host}"
            with cache_lock:
                channels_list = list(channels_cache.values())
                channels_list.sort(key=lambda x: x.get("orderIndex", 0))

            m3u_lines = ["#EXTM3U"]
            for ch in channels_list:
                cid = ch.get("id") or ch.get("vid")
                name = ch.get("name", "Channel").replace('"', "'")
                group = ch.get("groupTitle", "Live TV").replace('"', "'")
                logo = ch.get("logoUrl", "")
                proxy_stream_url = f"{base_origin}/live/{cid}.m3u8"
                extinf = f'#EXTINF:-1 tvg-id="{cid}" tvg-name="{name}" tvg-logo="{logo}" group-title="{group}",{name}'
                m3u_lines.append(extinf)
                m3u_lines.append(proxy_stream_url)

            content = ("\n".join(m3u_lines) + "\n").encode("utf-8")
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        # 3. On-Demand HLS Sliced Segments: /live/segment/<stream_key>/<segment_file>
        match_seg = re.match(r"^/live/segment/([^/]+)/([^/]+)$", path)
        if match_seg:
            stream_key = match_seg.group(1)
            seg_file = match_seg.group(2)
            self.handle_ondemand_segment(stream_key, seg_file)
            return

        # 4. Stream M3U8 Playlist: /live/<channel_id>.m3u8 or /raw/<channel_id>.m3u8 (Direct 100% Pure Stable Stream)
        match_live = re.match(r"^/(?:live|raw)/([^/]+)\.m3u8$", path)
        if match_live:
            cid = match_live.group(1)
            force_proxy = query.get("proxy", ["0"])[0] in ("1", "true")
            self.handle_channel_playlist(cid, is_raw=False, force_proxy=force_proxy)
            return

        # 5. Direct Continuous MPEG-TS Stream: Redirect to strictly M3U8 (No TS)
        match_ts = re.match(r"^/(?:live|raw)/([^/]+)\.ts$", path)
        if match_ts:
            cid = match_ts.group(1)
            self.send_response(302)
            self.send_cors_headers()
            self.send_header("Location", f"/live/{cid}.m3u8")
            self.end_headers()
            return

        # 6. Proxy Segment Chunk: /ts or /live/ts or /raw/ts
        if self.path.startswith("/ts?") or self.path.startswith("/live/ts?") or self.path.startswith("/raw/ts?") or self.path.startswith("/ts/") or self.path.startswith("/live/ts/") or self.path.startswith("/raw/ts/"):
            parsed_ts = urllib.parse.urlparse(self.path)
            qs_ts = urllib.parse.parse_qs(parsed_ts.query)
            target_url = qs_ts.get("url", [""])[0]
            ua_override = qs_ts.get("ua", [""])[0]
            ref_override = qs_ts.get("ref", [""])[0]
            if ua_override and "ua=" not in target_url:
                sep = "&" if "?" in target_url else "?"
                target_url += f"{sep}ua={ua_override}"
            if not target_url and self.path.startswith("/ts?url="):
                target_url = urllib.parse.unquote(self.path[8:])
            elif not target_url and self.path.startswith("/live/ts?url="):
                target_url = urllib.parse.unquote(self.path[13:])
            elif not target_url and self.path.startswith("/raw/ts?url="):
                target_url = urllib.parse.unquote(self.path[12:])
            if target_url:
                self.handle_ts_segment(target_url, ref_override)
                return

        # Fallback 404
        self.send_response(404)
        self.send_cors_headers()
        self.end_headers()
        try:
            self.wfile.write(b"Not Found")
        except (BrokenPipeError, ConnectionResetError):
            pass

    def build_target_and_ua(self, channel_obj, srv_choice="1"):
        """Extracts target upstream URL and headers for requested server"""
        servers_list = channel_obj.get("servers", [])
        target = ""
        target_sid = f"server-{srv_choice}" if not str(srv_choice).startswith("server-") else str(srv_choice)
        if servers_list:
            for s in servers_list:
                sid = str(s.get("id", ""))
                if sid == target_sid or sid == str(srv_choice):
                    s_url = s.get("upstreamUrl") or s.get("url", "")
                    if s_url and not s_url.startswith("/live/") and not s_url.startswith("/raw/"):
                        target = s_url
                        break

        if not target or target.startswith("/"):
            direct_m3u8 = channel_obj.get("directM3u8", "")
            play_url = channel_obj.get("playUrl", "")
            stream_url = channel_obj.get("streamUrl", "")

            if direct_m3u8 and not direct_m3u8.startswith("/"):
                target = direct_m3u8
            elif play_url and "play.php" in play_url:
                target = play_url
            elif "new-redirect.online" in stream_url:
                b64_url = base64.b64encode(stream_url.encode()).decode()
                ua_for_param = channel_obj.get("userAgent", "") or DEFAULT_UA
                b64_ua = base64.b64encode(ua_for_param.encode()).decode()
                target = f"https://yacine.website/play.php?url={b64_url}&ua={b64_ua}"
            elif play_url and not play_url.startswith("/"):
                target = play_url
            elif stream_url and not stream_url.startswith("/"):
                target = stream_url
            else:
                target = ""

        ua_candidate = channel_obj.get("userAgent", "")
        extracted_ua = ""
        if "ua=" in target:
            parsed_q = urllib.parse.parse_qs(urllib.parse.urlparse(target).query)
            encoded_ua = parsed_q.get("ua", [""])[0]
            if encoded_ua:
                try:
                    extracted_ua = base64.b64decode(encoded_ua).decode("utf-8", errors="ignore")
                except Exception:
                    pass

        if "workers.dev" in target or ".css" in target or "speedcdn" in target:
            final_ua = "OSCARTV2021"
        else:
            final_ua = extracted_ua or ua_candidate or DEFAULT_UA
        return target, final_ua

    def handle_direct_ts_stream(self, cid):
        """Streams continuous live MPEG-TS directly to VLC / IPTV players without ANY interruption"""
        parsed_url = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed_url.query)
        requested_server = qs.get("server", ["1"])[0]

        with cache_lock:
            ch = channels_cache.get(cid)
        if not ch:
            load_channels_from_disk()
            with cache_lock:
                ch = channels_cache.get(cid)

        if not ch:
            self.send_response(404)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Channel Not Found")
            return

        target_fetch_url, req_ua = self.build_target_and_ua(ch, requested_server)
        if not target_fetch_url:
            self.send_response(502)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Upstream Unavailable")
            return

        headers = {
            "User-Agent": req_ua or "VLC/3.0.18 LibVLC/3.0.18",
            "Accept": "*/*",
            "Connection": "close"
        }
        if "yacine.website" in target_fetch_url or "new-redirect.online" in target_fetch_url:
            headers["Referer"] = "https://yacine.website/"
            headers["Origin"] = "https://yacine.website"
            headers["X-Forwarded-For"] = "156.200.1.1"

        try:
            req = urllib.request.Request(target_fetch_url, headers=headers)
            with PROXY_OPENER.open(req, timeout=15) as upstream:
                self.send_response(200)
                self.send_cors_headers()
                self.send_header("Content-Type", "video/mp2t")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Connection", "close")
                self.end_headers()

                while True:
                    chunk = upstream.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            try:
                self.send_response(502)
                self.send_cors_headers()
                self.end_headers()
            except Exception:
                pass

    def handle_channel_playlist(self, cid, is_raw=False, force_proxy=False):
        """Fetches upstream M3U8, rewrites segment URLs, and returns pure M3U8 to client"""
        ua_hdr = self.headers.get("User-Agent", "").lower()
        host = self.headers.get("X-Forwarded-Host", self.headers.get("Host", "localhost"))
        if "127.0.0.1" in host or "localhost" in host:
            host = "aspreen-tv-production.up.railway.app"
        proto = self.headers.get("X-Forwarded-Proto", "https" if ("railway" in host or "443" in host) else "http")
        if "railway" in host:
            proto = "https"
        base_origin = f"{proto}://{host}"



        now_ts = time.time()
        parsed_url = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed_url.query)
        requested_server = qs.get("server", ["1"])[0]

        cache_key = f"{cid}_{requested_server}_proxy" if force_proxy else (f"{cid}_{requested_server}_raw" if is_raw else f"{cid}_{requested_server}")
        with m3u8_cache_lock:
            cached_data = m3u8_cache.get(cache_key)
            if cached_data and now_ts < cached_data[1]:
                self.send_response(200)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/vnd.apple.mpegurl")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
                self.send_header("Content-Length", str(len(cached_data[0])))
                self.end_headers()
                try:
                    self.wfile.write(cached_data[0])
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return

        with cache_lock:
            ch = channels_cache.get(cid)

        if not ch:
            load_channels_from_disk()
            with cache_lock:
                ch = channels_cache.get(cid)

        if not ch:
            self.send_response(404)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Channel Not Found")
            return

        ch_ref = ch.get("referer")
        if ch.get("source") == "yacine.website" or "yacine.website" in str(ch.get("playUrl", "")) or len(cid) >= 15:
            channel_referer = f"https://yacine.website/channel/{cid}/live"
        elif ch_ref:
            channel_referer = ch_ref
        elif "workers.dev" in str(ch.get("streamUrl", "")) or ".css" in str(ch.get("streamUrl", "")) or "speedcdn" in str(ch.get("streamUrl", "")):
            channel_referer = "http://speedcdn.me:8080/"
        else:
            slug = re.sub(r'[^a-zA-Z0-9]+', '-', ch.get('name', 'live')).strip('-') or 'live'
            channel_referer = f"https://yacine.website/channel/{cid}/{slug}"

        target_fetch_url, req_ua = self.build_target_and_ua(ch, requested_server)

        # Only trigger renewal if we have no target stream url at all or if target is local
        if not target_fetch_url or target_fetch_url.startswith("/") or target_fetch_url.startswith("http://127.0.0.1"):
            renew_single_channel_stream(cid)
            with cache_lock:
                ch = channels_cache.get(cid, {})
                target_fetch_url, req_ua = self.build_target_and_ua(ch, requested_server)

        if not target_fetch_url:
            self.send_response(502)
            self.send_cors_headers()
            self.end_headers()
            try:
                self.wfile.write(b"Upstream Unavailable")
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        # If alternative server is a direct continuous TS stream (e.g. VIP OTT), slice on-demand to HLS
        if target_fetch_url and ("extension=ts" in target_fetch_url or target_fetch_url.endswith(".ts")):
            stream_key, m3u_text = ON_DEMAND_STREAM_MANAGER.get_or_start_stream(cid, requested_server, target_fetch_url)
            if stream_key:
                ON_DEMAND_STREAM_MANAGER.touch(stream_key)
            if not m3u_text:
                self.send_response(503)
                self.send_cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                try:
                    self.wfile.write(b"Server Initializing Stream...")
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return

            # Strip any transient #EXT-X-ENDLIST so the player never stops polling or treats live stream as VOD
            m3u_text = re.sub(r"#EXT-X-ENDLIST\r?\n?", "", m3u_text)

            rewritten = []
            for line in m3u_text.splitlines():
                l = line.strip()
                if not l or l.startswith("#EXT-X-ENDLIST"):
                    continue
                if l.startswith("#"):
                    rewritten.append(l)
                else:
                    seg_name = os.path.basename(l)
                    rewritten.append(f"{base_origin}/live/segment/{stream_key}/{seg_name}")

            out_body = ("\n".join(rewritten) + "\n").encode("utf-8")
            with m3u8_cache_lock:
                m3u8_cache[cache_key] = (out_body, time.time() + 0.8)
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/vnd.apple.mpegurl")
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Content-Length", str(len(out_body)))
            self.end_headers()
            try:
                self.wfile.write(out_body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return


        def fetch_m3u(url, user_agent, max_retries=2):
            headers = {
                "User-Agent": user_agent or DEFAULT_UA,
                "Referer": channel_referer,
                "Origin": "https://yacine.website",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "Accept": "*/*"
            }
            if "edgenextcdn.net" in url:
                headers.pop("Referer", None)
                headers.pop("Origin", None)
            elif "yacine.website" in url or "new-redirect.online" in url or ".buzz" in url or ".lol" in url:
                headers["X-Forwarded-For"] = "156.200.1.1"

            for attempt in range(max_retries):
                try:
                    r = urllib.request.Request(url, headers=headers)
                    with PROXY_OPENER.open(r, timeout=12) as resp:
                        content = resp.read().decode("utf-8", errors="ignore")
                        if "#EXTM3U" in content:
                            return content
                        if ("No URLs available" in content or not content) and attempt < max_retries - 1:
                            time.sleep(0.3)
                            continue
                        return content
                except Exception:
                    if attempt < max_retries - 1:
                        time.sleep(0.3)
                        continue
            return ""

        m3u_text = fetch_m3u(target_fetch_url, req_ua, max_retries=2)

        # If expired or returned error, auto-renew fresh token if dynamic yacine channel
        if not m3u_text or "#EXTM3U" not in m3u_text or "No URLs available" in m3u_text:
            if renew_single_channel_stream(cid):
                with cache_lock:
                    ch = channels_cache.get(cid, {})
                    target_fetch_url, req_ua = self.build_target_and_ua(ch)
                if target_fetch_url:
                    m3u_text = fetch_m3u(target_fetch_url, req_ua, max_retries=2)

        if not m3u_text or "#EXTM3U" not in m3u_text:
            err_msg = ch.get("status_message", "القناة غير متوفرة حالياً من المصدر الأصلي")
            self.send_response(503)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            try:
                self.wfile.write(f"Channel Offline: {err_msg}".encode("utf-8"))
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        # Check media sequence to prevent backwards jumps from load-balanced mirrors
        match_seq = re.search(r"#EXT-X-MEDIA-SEQUENCE:(\d+)", m3u_text)
        if match_seq:
            curr_seq = int(match_seq.group(1))
            prev_seq = channel_max_sequence.get(cid, 0)
            if curr_seq < prev_seq and (prev_seq - curr_seq) < 30:
                with m3u8_cache_lock:
                    cached_data = m3u8_cache.get(cache_key)
                    if cached_data:
                        self.send_response(200)
                        self.send_cors_headers()
                        self.send_header("Content-Type", "application/vnd.apple.mpegurl")
                        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                        self.send_header("Pragma", "no-cache")
                        self.send_header("Expires", "0")
                        self.send_header("Content-Length", str(len(cached_data[0])))
                        self.end_headers()
                        try:
                            self.wfile.write(cached_data[0])
                        except (BrokenPipeError, ConnectionResetError):
                            pass
                        return
            else:
                channel_max_sequence[cid] = curr_seq

        # Rewrite segment and key URLs while preserving 100% of upstream headers, timestamps, and sequence order
        rewritten = []
        for line in m3u_text.splitlines():
            l = line.strip()
            if not l:
                continue
            if l.startswith("#"):
                if 'URI="' in l:
                    def replace_uri(m):
                        u = m.group(1)
                        full_u = urllib.parse.urljoin(target_fetch_url, u)
                        if force_proxy:
                            enc_u = urllib.parse.quote(full_u, safe="")
                            enc_r = urllib.parse.quote(channel_referer, safe="")
                            return f'URI="/live/ts/chunk.ts?url={enc_u}&ref={enc_r}"'
                        if "edgenextcdn.net" in full_u or "itworkscdn.net" in full_u or ch.get("source") != "yacine.website":
                            return f'URI="{full_u}"'
                        if "play.php?" in full_u:
                            return f'URI="https://yacine.website/play.php?{full_u.split("?", 1)[1]}"'
                        b64_k = base64.b64encode(full_u.encode()).decode()
                        b64_u = base64.b64encode((req_ua or DEFAULT_UA).encode()).decode()
                        return f'URI="https://yacine.website/play.php?url={b64_k}&ua={b64_u}"'
                    rewritten.append(re.sub(r'URI="([^"]+)"', replace_uri, l))
                else:
                    rewritten.append(l)
            else:
                # Segment URL or Sub-playlist URL: Direct clean CDN URL so IDM never intercepts it
                seg_full = urllib.parse.urljoin(target_fetch_url, l)
                if "play.php?" in l:
                    direct_seg = f"https://yacine.website/play.php?{l.split('?', 1)[1]}"
                elif "new-redirect.online" in seg_full and "play.php" not in seg_full:
                    b64_url = base64.b64encode(seg_full.encode()).decode()
                    b64_ua = base64.b64encode((req_ua or DEFAULT_UA).encode()).decode()
                    direct_seg = f"https://yacine.website/play.php?url={b64_url}&ua={b64_ua}"
                elif "play.php?" in seg_full:
                    direct_seg = seg_full
                else:
                    direct_seg = seg_full

                if force_proxy:
                    encoded_seg = urllib.parse.quote(direct_seg, safe="")
                    encoded_ref = urllib.parse.quote(channel_referer, safe="")
                    rewritten.append(f"{base_origin}/live/ts/chunk.ts?url={encoded_seg}&ref={encoded_ref}")
                else:
                    rewritten.append(direct_seg)

        # Strip any transient #EXT-X-ENDLIST to prevent players from treating live as finished VOD
        clean_rewritten = [l for l in rewritten if not l.startswith("#EXT-X-ENDLIST")]
        out_body = ("\n".join(clean_rewritten) + "\n").encode("utf-8")
        with m3u8_cache_lock:
            m3u8_cache[cache_key] = (out_body, time.time() + 0.8)
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/vnd.apple.mpegurl")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("Content-Length", str(len(out_body)))
        self.end_headers()
        try:
            self.wfile.write(out_body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def handle_ts_segment(self, target_url, ref_override=""):
        """Pipes upstream TS segment chunks to client seamlessly with exact headers"""
        # If target is raw new-redirect.online without play.php, wrap it in play.php
        if "new-redirect.online" in target_url and "play.php" not in target_url:
            b64_t = base64.b64encode(target_url.encode()).decode()
            b64_u = base64.b64encode(DEFAULT_UA.encode()).decode()
            target_url = f"https://yacine.website/play.php?url={b64_t}&ua={b64_u}"

        # Ensure play.php always has ua parameter
        if "play.php" in target_url and "ua=" not in target_url:
            b64_u = base64.b64encode(DEFAULT_UA.encode()).decode()
            sep = "&" if "?" in target_url else "?"
            target_url = f"{target_url}{sep}ua={b64_u}"

        decoded_ua = ""
        if "ua=" in target_url:
            try:
                parsed_q = urllib.parse.parse_qs(urllib.parse.urlparse(target_url).query)
                encoded_ua = parsed_q.get("ua", [""])[0]
                if encoded_ua:
                    decoded_ua = base64.b64decode(encoded_ua).decode("utf-8", errors="ignore")
            except Exception:
                pass

        referer = ref_override or "https://yacine.website/"
        ua = decoded_ua or DEFAULT_UA
        if "workers.dev" in target_url or ".css" in target_url or "getmycssfiles" in target_url or "alljava" in target_url or "ourjav" in target_url or "allmyfilescss" in target_url or "assetsfileslocal" in target_url or "pushyourcss" in target_url:
            ua = "OSCARTV2021"
            referer = "http://speedcdn.me:8080/"

        # Check instant in-memory cache first (< 1ms response)
        now = time.time()
        with hot_cache_lock:
            cached = HOT_SEGMENT_CACHE.get(target_url)
            if cached and now < cached[1]:
                data = cached[0]
                self.send_response(200)
                self.send_cors_headers()
                self.send_header("Content-Type", "video/mp2t")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "public, max-age=120, immutable")
                self.end_headers()
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return

        headers = {
            "User-Agent": ua,
            "Referer": referer,
            "Origin": "https://yacine.website",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Accept": "*/*"
        }
        if "edgenextcdn.net" in target_url:
            headers.pop("Referer", None)
            headers.pop("Origin", None)
        elif "yacine.website" in target_url or "new-redirect.online" in target_url or ".buzz" in target_url or ".lol" in target_url:
            headers["X-Forwarded-For"] = "156.200.1.1"

        for attempt in range(4):
            try:
                req = urllib.request.Request(target_url, headers=headers)
                with PROXY_OPENER.open(req, timeout=25) as upstream:
                    first_chunk = upstream.read(64 * 1024)
                    if not first_chunk or first_chunk.startswith(b"No URLs available") or first_chunk.startswith(b"<html>") or first_chunk.startswith(b"<html") or first_chunk.startswith(b"<!DOCTYPE"):
                        if attempt < 3:
                            headers["Referer"] = "https://yacine.website/"
                            time.sleep(0.8)
                            continue
                        self.send_response(404)
                        self.send_cors_headers()
                        self.end_headers()
                        return

                    # Handle Nested / Variant M3U8 (Adaptive bitrates e.g. MBC, Rotana)
                    if first_chunk.startswith(b"#EXTM3U"):
                        rest = upstream.read()
                        full_m3u = (first_chunk + rest).decode("utf-8", errors="ignore")
                        lines = full_m3u.splitlines()
                        rewritten = []
                        for line in lines:
                            l = line.strip()
                            if not l:
                                continue
                            if l.startswith("#"):
                                if 'URI="' in l:
                                    def replace_sub_uri(m):
                                        u = m.group(1)
                                        full_u = urllib.parse.urljoin(target_url, u)
                                        enc_u = urllib.parse.quote(full_u, safe="")
                                        enc_r = urllib.parse.quote(referer, safe="")
                                        return f'URI="/live/ts/chunk.ts?url={enc_u}&ref={enc_r}"'
                                    rewritten.append(re.sub(r'URI="([^"]+)"', replace_sub_uri, l))
                                else:
                                    rewritten.append(l)
                            else:
                                seg_full = urllib.parse.urljoin(target_url, l)
                                encoded_seg = urllib.parse.quote(seg_full, safe="")
                                encoded_ref = urllib.parse.quote(referer, safe="")
                                rewritten.append(f"/live/ts/chunk.ts?url={encoded_seg}&ref={encoded_ref}")

                        out_body = ("\n".join(rewritten) + "\n").encode("utf-8")
                        self.send_response(200)
                        self.send_cors_headers()
                        self.send_header("Content-Type", "application/vnd.apple.mpegurl")
                        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                        self.send_header("Content-Length", str(len(out_body)))
                        self.end_headers()
                        try:
                            self.wfile.write(out_body)
                        except (BrokenPipeError, ConnectionResetError):
                            pass
                        return

                    # Strict validation: Every valid MPEG-TS segment MUST begin with 0x47
                    if not first_chunk or first_chunk[0] != 0x47:
                        self.send_response(503)
                        self.send_cors_headers()
                        self.end_headers()
                        return

                    status = upstream.getcode()
                    content_len = upstream.headers.get("Content-Length")
                    self.send_response(status if status else 200)
                    self.send_cors_headers()
                    self.send_header("Content-Type", "video/mp2t")
                    if content_len:
                        self.send_header("Content-Length", content_len)
                    self.end_headers()

                    try:
                        self.wfile.write(first_chunk)
                        chunks_acc = [first_chunk]
                        while True:
                            chunk = upstream.read(64 * 1024)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            chunks_acc.append(chunk)

                        full_seg = b"".join(chunks_acc)
                        with hot_cache_lock:
                            HOT_SEGMENT_CACHE[target_url] = (full_seg, time.time() + 45.0)
                    except (BrokenPipeError, ConnectionResetError):
                        return
                    return
            except (BrokenPipeError, ConnectionResetError):
                # Client disconnected or seeked in player - normal in live streaming
                return
            except Exception as e:
                if attempt < 1:
                    time.sleep(0.3)
                    continue
                try:
                    self.send_response(404)
                    self.send_cors_headers()
                    self.end_headers()
                except (BrokenPipeError, ConnectionResetError):
                    pass
    def handle_ondemand_segment(self, stream_key, seg_file):
        """Serves on-demand HLS sliced TS segment directly with zero upstream overhead and RAM cache"""
        ON_DEMAND_STREAM_MANAGER.touch(stream_key)
        clean_key = re.sub(r"[^a-zA-Z0-9_\-]", "", stream_key)
        clean_file = re.sub(r"[^a-zA-Z0-9_\-\.]", "", seg_file)
        cache_key = f"{clean_key}_{clean_file}"

        now = time.time()
        with hot_cache_lock:
            cached = HOT_SEGMENT_CACHE.get(cache_key)
            if cached and now < cached[1]:
                data = cached[0]
                self.send_response(200)
                self.send_cors_headers()
                self.send_header("Content-Type", "video/mp2t")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "public, max-age=180, immutable")
                self.end_headers()
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return

        seg_path = os.path.join(ON_DEMAND_STREAM_MANAGER.base_dir, clean_key, clean_file)

        # Wait briefly up to 2.5s if segment is still finishing write
        for _ in range(25):
            if os.path.exists(seg_path) and os.path.getsize(seg_path) > 0:
                break
            time.sleep(0.1)

        if not os.path.exists(seg_path):
            self.send_response(404)
            self.send_cors_headers()
            self.end_headers()
            return

        try:
            with open(seg_path, "rb") as f:
                data = f.read()

            with hot_cache_lock:
                HOT_SEGMENT_CACHE[cache_key] = (data, time.time() + 180.0)

            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "video/mp2t")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "public, max-age=180, immutable")
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            try:
                self.send_response(500)
                self.send_cors_headers()
                self.end_headers()
            except Exception:
                pass


def start_server():
    """Starts the 24/7 multi-threaded HTTP proxy server"""
    load_channels_from_disk()

    # Launch background worker for periodic auto-renew
    t_worker = threading.Thread(target=background_auto_renew_loop, daemon=True)
    t_worker.start()

    # Launch background telegram heartbeat
    if TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID:
        t_tg = threading.Thread(target=telegram_heartbeat_loop, daemon=True)
        t_tg.start()

    server_address = ("0.0.0.0", PORT)
    httpd = ThreadingHTTPServer(server_address, StreamProxyHTTPHandler)

    print("\n" + "=" * 68)
    print("      🚀 ASPREEN TV ▸ 24/7 PERSISTENT STREAM PROXY IS ONLINE")
    print("=" * 68)
    print(f" 🌐 خادم البث المستمر يعمل الآن على: http://127.0.0.1:{PORT}")
    print(f" 📺 رابط تشغيل أي قناة بثابت دائم: http://127.0.0.1:{PORT}/live/{{CHANNEL_ID}}.m3u8")
    print(f" 📁 قائمة القنوات الشاملة M3U: http://127.0.0.1:{PORT}/playlist.m3u")
    print(f" 🔄 التجديد التلقائي للروابط: كل {AUTO_RENEW_INTERVAL_SECONDS // 60} دقيقة تلقائياً")
    print(f" 🛡️ البث لا ينقطع 24 ساعة بدون أي تدخل يدوي")
    print("=" * 68 + "\n")

    # Notify Telegram Start
    if TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID:
        send_telegram_message(
            "🚀 <b>تم تشغيل خادم البث المستمر (24/7 Stream Proxy) بنجاح!</b>\n\n"
            f"🌐 <b>المنفذ:</b> <code>{PORT}</code>\n"
            f"📺 <b>القنوات المحملة:</b> <code>{len(channels_cache)}</code> قناة\n"
            f"🔄 <b>دورة التجديد:</b> كل 30 دقيقة تلقائياً\n"
            f"⏱️ <b>وقت البدء:</b> {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            "✅ <i>سيرفر البث يعمل في الخلفية ويحافظ على استقرار القنوات 24 ساعة.</i>"
        )

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n [!] تم إيقاف الخادم يدوياً.")
        httpd.server_close()


if __name__ == "__main__":
    start_server()
