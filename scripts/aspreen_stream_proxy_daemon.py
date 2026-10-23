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
import hmac
import hashlib
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

# Ensure UTF-8 output on all platforms (Windows & Linux/Docker)
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
except Exception:
    pass


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

# -----------------------------------------------------------------------------
# Anti-Theft & Link Protection Engine (Level 1: Origin/Referer Lock, Level 2: HMAC Signed Tokens)
# -----------------------------------------------------------------------------
STREAM_SECURITY_SECRET = os.environ.get("STREAM_SECURITY_SECRET", "aspreen_vault_sec_77a9b0c2").encode("utf-8")
SEGMENT_TOKEN_TTL = int(os.environ.get("SEGMENT_TOKEN_TTL", "360"))  # 6 minutes
SECURITY_STRICT_TOKENS = os.environ.get("SECURITY_STRICT_TOKENS", "0") == "1"

def make_segment_token(clean_key, session_id, seg_file, expires):
    payload = f"{clean_key}:{session_id}:{seg_file}:{expires}".encode("utf-8")
    return hmac.new(STREAM_SECURITY_SECRET, payload, hashlib.sha256).hexdigest()[:16]

def verify_segment_token(clean_key, session_id, seg_file, token, expires_str):
    try:
        expires = int(expires_str)
        if time.time() > expires:
            return False, "Token Expired"
        expected = make_segment_token(clean_key, session_id, seg_file, expires)
        if hmac.compare_digest(token, expected):
            return True, "Valid"
        return False, "Invalid Signature"
    except Exception:
        return False, "Verification Error"


def encode_stream_slug(cid, server="1", expires=None):
    raw = f"{cid}|{server}|{expires}" if expires else f"{cid}|{server}"
    b64 = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
    sig = hmac.new(STREAM_SECURITY_SECRET, b64.encode(), hashlib.sha256).hexdigest()[:8]
    return f"{b64}.{sig}"

def decode_stream_slug(slug):
    try:
        if "." not in slug:
            return None, None
        b64, sig = slug.rsplit(".", 1)
        expected_sig = hmac.new(STREAM_SECURITY_SECRET, b64.encode(), hashlib.sha256).hexdigest()[:8]
        if not hmac.compare_digest(sig, expected_sig):
            return None, None
        pad = len(b64) % 4
        if pad:
            b64 += "=" * (4 - pad)
        decoded = base64.urlsafe_b64decode(b64).decode()
        parts = decoded.split("|")
        cid = parts[0]
        srv = parts[1] if len(parts) > 1 else "1"
        if len(parts) > 2 and parts[2]:
            exp = int(parts[2])
            if time.time() > exp:
                return None, None  # Expired
        return cid, srv
    except Exception:
        return None, None


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

def _prune_hot_segment_cache():
    now = time.time()
    with hot_cache_lock:
        for k in [k for k, v in HOT_SEGMENT_CACHE.items() if now > v[1]]:
            HOT_SEGMENT_CACHE.pop(k, None)


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


# Seamless TS->HLS engine (upstream reconnects never restart FFmpeg, no replayed seconds, unique segment names)
from ondemand_engine import OnDemandStreamManager

ON_DEMAND_STREAM_MANAGER = OnDemandStreamManager(
    HLS_ONDEMAND_DIR,
    maintenance_callback=_prune_hot_segment_cache,
    alert_callback=send_telegram_message
)


def load_channels_from_disk():
    """Loads existing channels.json and shahid_channels.json into memory"""
    global channels_cache
    shahid_json_path = os.path.join(DATA_DIR, "shahid_channels.json")
    for file_path in [CHANNELS_JSON_PATH, shahid_json_path]:
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                now = time.time()
                with cache_lock:
                    for ch in data:
                        cid = str(ch.get("id") or ch.get("vid"))
                        if not ch.get("lastRenewed"):
                            ch["lastRenewed"] = now
                        channels_cache[cid] = ch
                        channels_cache[urllib.parse.unquote(cid)] = ch
                        channels_cache[urllib.parse.quote(cid)] = ch
            except Exception as e:
                print(f" [!] خطأ في قراءة ملف {file_path}: {e}")
    print(f" [✓] تم تحميل {len(channels_cache)} قناة في الذاكرة الحية.")


def renew_single_channel_stream(cid):
    """Fetches a fresh stream URL for a single channel from upstream API"""
    with cache_lock:
        ch = channels_cache.get(cid, {})
        # Never overwrite private VIP OTT satellite channels or Shahid livestream channels with Yacine
        if (
            ch.get("source") in ("private-vip", "shahid-livestream")
            or cid.startswith("shahid-")
            or cid.startswith("rotana-")
            or cid == "alresalah"
            or "mac=" in str(ch.get("directM3u8", ""))
            or "hey-ott.net" in str(ch.get("directM3u8", ""))
            or cid in ("bein-vip-bein-sports-news", "bein-vip-bein-sports-global")
            or not ch.get("yacineId")
        ):
            return False
        name = ch.get("name", "live")
        target_id = ch.get("yacineId") or cid
    api_url = f"https://yacine.website/index.php?get_channel_stream={target_id}"
    headers = dict(BYPASS_HEADERS)
    slug = re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-') or 'live'
    headers["Referer"] = f"https://yacine.website/channel/{target_id}/{slug}"

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
                        if ch.get("servers"):
                            for s in ch["servers"]:
                                if s.get("id") == "server-1" and not ("mac=" in str(s.get("upstreamUrl", "")) or "hey-ott.net" in str(s.get("upstreamUrl", ""))) and ("re300" in str(s.get("upstreamUrl", "")) or "yacine" in str(s.get("upstreamUrl", ""))):
                                    s["upstreamUrl"] = raw_url
                        ch["userAgent"] = ua or DEFAULT_UA
                        ch["status"] = "live"
                        ch["source"] = "yacine.website"
                        ch["referer"] = f"https://yacine.website/channel/{target_id}/live"
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
                    if (ch.get("lastRenewed", 0) > (now - 3600) or cid in primary_sports or ch.get("yacineId"))
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

    def get_client_ip(self):
        xff = self.headers.get("X-Forwarded-For", "")
        if xff:
            return xff.split(",")[0].strip()
        return self.client_address[0]

    def is_allowed_origin(self):
        path = urllib.parse.urlparse(self.path).path

        # 1. Internal health check & status endpoints (always public for Railway / Docker)
        if path in ("/status", "/", "/health", "/status/engine", "/api/engine/status"):
            return True, "*"

        # 1.5. Signed video segments with HMAC signature are protected by cryptographic token
        parsed_url = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed_url.query)
        if path.startswith("/live/segment/") and qs.get("h") and qs.get("exp"):
            return True, "*"

        origin = self.headers.get("Origin", "").strip()
        referer = self.headers.get("Referer", "").strip()
        ua = self.headers.get("User-Agent", "").strip().lower()
        client_ip = self.get_client_ip()

        # 2. Localhost & Loopback whitelist (direct playback on server)
        if client_ip in ("127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"):
            return True, "*"

        # 3. Secret bypass key or bot parameter in URL (?key=tvora, ?key=discord, ?bot=1)
        req_key = qs.get("key", [""])[0].lower()
        if req_key in ("tvora", "aspreen", "discord", "admin") or qs.get("bot", [""])[0] == "1":
            return True, "*"

        # 4. Authorized Media Players, Android Apps & Mobile Frameworks (VLC, ExoPlayer, Kodi, Smart TV, etc.)
        media_player_tokens = [
            "tvora", "aspreen", "discord", "chrome/107.0.0.0", "safari/537.3",
            "vlc", "libvlc", "exoplayer", "stagefright", "kodi", "lavf", 
            "ffmpeg", "applecoremedia", "okhttp", "dalvik", "smarttv", "tizen", "webos", "iptv"
        ]
        if (
            any(tok in ua for tok in media_player_tokens) or
            app_key in ("tvora", "aspreen", "discord") or
            self.headers.get("X-Tvora-App") or
            self.headers.get("X-Discord-Bot")
        ):
            return True, "*"

        # 5. Authorized Web Browser Domains (tvora.site, railway.app, etc.)
        if origin or referer:
            origin_lower = origin.lower()
            referer_lower = referer.lower()
            allowed_patterns = [
                "tvora.site", "tvora", "aspreen", "railway.app", "localhost", "127.0.0.1"
            ]
            env_allowed = os.getenv("ALLOWED_ORIGINS", "")
            if env_allowed:
                for d in env_allowed.split(","):
                    d = d.strip().lower()
                    if d:
                        allowed_patterns.append(d)

            for pattern in allowed_patterns:
                if (origin_lower and pattern in origin_lower) or (referer_lower and pattern in referer_lower):
                    return True, origin or "*"

            # Unauthorized external website / hotlinking thief!
            return False, None

        # 6. Direct external player (VLC, Kodi, Smart TV, direct link in player) without browser Origin/Referer
        return True, "*"

    def send_cors_headers(self):
        allowed, matched_origin = self.is_allowed_origin()
        allow_val = matched_origin if (allowed and matched_origin) else (self.headers.get("Origin") or "*")
        self.send_header("Access-Control-Allow-Origin", allow_val)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Expose-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        try:
            self._handle_get_request()
        except Exception as e:
            import traceback
            err = traceback.format_exc()
            print(f" [!] Unhandled exception in do_GET ({self.path}):\n{err}", flush=True)
            try:
                self.send_response(500)
                self.send_cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(f"500 Internal Server Error: {e}\n{err}".encode("utf-8"))
            except Exception:
                pass

    def _handle_get_request(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Level 1 Anti-Hotlinking: Only block explicitly blacklisted domains
        allowed, _ = self.is_allowed_origin()
        if not allowed:
            self.send_response(403)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"403 Forbidden: Hotlinking from this domain is prohibited.")
            return

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

        # 1.1 Engine Health & Realtime Diagnostics (/status/engine)
        if path == "/status/engine" or path == "/api/engine/status":
            stats = ON_DEMAND_STREAM_MANAGER.stats()
            body = json.dumps(stats, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 1.2 Channel Stop Control endpoint (/api/engine/stop or /live/control/stop)
        if path == "/api/engine/stop" or path == "/live/control/stop":
            cid = query.get("id", [""])[0] or query.get("cid", [""])[0]
            stopped = []
            if cid:
                stopped = ON_DEMAND_STREAM_MANAGER.stop_channel_streams(cid)
            load_channels_from_disk()
            body = json.dumps({"status": "stopped", "cid": cid, "stopped_streams": stopped}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        # 1.3 Channels Reload endpoint (/api/engine/reload or /live/control/reload)
        if path == "/api/engine/reload" or path == "/live/control/reload":
            load_channels_from_disk()
            body = json.dumps({"status": "reloaded", "total": len(channels_cache)}, ensure_ascii=False).encode("utf-8")
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

        # 3. On-Demand HLS Sliced Segments: /live/segment/<stream_key>/<session>/<segment_file> or legacy /live/segment/<stream_key>/<segment_file>
        match_seg_session = re.match(r"^/live/segment/([^/]+)/([^/]+)/([^/]+)$", path)
        if match_seg_session:
            stream_key = match_seg_session.group(1)
            session_id = match_seg_session.group(2)
            seg_file = match_seg_session.group(3)
            self.handle_ondemand_segment(stream_key, seg_file, session_id=session_id)
            return

        match_seg = re.match(r"^/live/segment/([^/]+)/([^/]+)$", path)
        if match_seg:
            stream_key = match_seg.group(1)
            seg_file = match_seg.group(2)
            self.handle_ondemand_segment(stream_key, seg_file)
            return

        # 3.5 Token Generator API: /live/token?id=<channel_id>&server=<server_id>
        if path == "/live/token" or path == "/api/stream/token":
            cid = query.get("id", [""])[0] or query.get("cid", [""])[0]
            srv = query.get("server", ["1"])[0]
            if cid:
                slug = encode_stream_slug(cid, srv)
                host = self.headers.get("X-Forwarded-Host", self.headers.get("Host", f"127.0.0.1:{PORT}"))
                proto = self.headers.get("X-Forwarded-Proto", "https" if ("railway" in host or "443" in host) else "http")
                if "railway" in host:
                    proto = "https"
                base_origin = f"{proto}://{host}"
                masked_url = f"{base_origin}/live/s/{slug}.m3u8"
                resp_data = json.dumps({"status": "success", "channelId": cid, "server": srv, "url": masked_url, "slug": slug}).encode("utf-8")
                self.send_response(200)
                self.send_cors_headers()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(resp_data)))
                self.end_headers()
                self.wfile.write(resp_data)
                return

        # 3.6 Masked / Disguised Stream Playlist: /live/s/<slug>.m3u8 or /live/stream/<slug>.m3u8
        match_masked = re.match(r"^/live/(?:s|stream)/([^/]+)\.m3u8$", path)
        if match_masked:
            slug = match_masked.group(1)
            cid, srv = decode_stream_slug(slug)
            if cid:
                force_proxy = query.get("proxy", ["1"])[0] not in ("0", "false")
                self.handle_channel_playlist(cid, is_raw=False, force_proxy=force_proxy, server_override=srv)
                return
            else:
                self.send_response(403)
                self.send_cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"403 Forbidden: Invalid or Expired Stream Token")
                return

        # 4. Stream M3U8 Playlist: /live/<channel_id>.m3u8 or /raw/<channel_id>.m3u8 (Direct 100% Pure Stable Stream)
        match_live = re.match(r"^/(?:live|raw)/([^/]+)\.m3u8$", path)
        if match_live:
            cid = urllib.parse.unquote(match_live.group(1))
            # Default force_proxy to True so external websites never encounter CORS or 403 Forbidden errors!
            force_proxy = query.get("proxy", ["1"])[0] not in ("0", "false")
            self.handle_channel_playlist(cid, is_raw=False, force_proxy=force_proxy)
            return

        # 5. Direct Continuous MPEG-TS Stream: Redirect to strictly M3U8 (No TS)
        match_ts = re.match(r"^/(?:live|raw)/([^/]+)\.ts$", path)
        if match_ts:
            cid = urllib.parse.unquote(match_ts.group(1))
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

        if "new-redirect.online" in target and "play.php" not in target:
            b64_url = base64.b64encode(target.encode()).decode()
            ua_for_param = final_ua or DEFAULT_UA
            b64_ua = base64.b64encode(ua_for_param.encode()).decode()
            target = f"https://yacine.website/play.php?url={b64_url}&ua={b64_ua}"

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

        if ch.get("status") == "event_only" or ch.get("inputStatus") == "OFFLINE":
            self.send_response(503)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("X-Channel-Status", "NO_EVENT")
            self.end_headers()
            try:
                self.wfile.write("لا يوجد حدث حالياً للقناة".encode("utf-8"))
            except (BrokenPipeError, ConnectionResetError):
                pass
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

    def handle_channel_playlist(self, cid, is_raw=False, force_proxy=False, server_override=None):
        """Fetches upstream M3U8, rewrites segment URLs, and returns pure M3U8 to client"""
        cid = urllib.parse.unquote(cid)
        host = self.headers.get("X-Forwarded-Host", self.headers.get("Host", f"127.0.0.1:{PORT}"))
        proto = self.headers.get("X-Forwarded-Proto", "https" if ("railway" in host or "443" in host) else "http")
        if "railway" in host:
            proto = "https"
        base_origin = f"{proto}://{host}"



        now_ts = time.time()
        parsed_url = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed_url.query)
        requested_server = str(server_override) if server_override else qs.get("server", ["1"])[0]
        client_ip = self.get_client_ip()

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

        if ch.get("status") == "event_only" or ch.get("inputStatus") == "OFFLINE":
            self.send_response(503)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("X-Channel-Status", "NO_EVENT")
            self.send_header("Retry-After", "10")
            self.end_headers()
            try:
                self.wfile.write("لا يوجد حدث حالياً للقناة".encode("utf-8"))
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        yacine_id = ch.get("yacineId") or cid
        ch_ref = ch.get("referer")
        if ch.get("source") == "yacine.website" or "yacine.website" in str(ch.get("playUrl", "")) or len(str(yacine_id)) >= 15:
            channel_referer = f"https://yacine.website/channel/{yacine_id}/live"
        elif ch_ref:
            channel_referer = ch_ref
        elif "workers.dev" in str(ch.get("streamUrl", "")) or ".css" in str(ch.get("streamUrl", "")) or "speedcdn" in str(ch.get("streamUrl", "")):
            channel_referer = "http://speedcdn.me:8080/"
        else:
            slug = re.sub(r'[^a-zA-Z0-9]+', '-', ch.get('name', 'live')).strip('-') or 'live'
            channel_referer = f"https://yacine.website/channel/{yacine_id}/{slug}"

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
            res = ON_DEMAND_STREAM_MANAGER.get_or_start_stream(cid, requested_server, target_fetch_url)
            status = "ok"
            if isinstance(res, tuple) and len(res) == 4:
                stream_key, session_id, m3u_text, status = res
            elif isinstance(res, tuple) and len(res) == 3:
                stream_key, session_id, m3u_text = res
                status = "ok" if m3u_text else "starting"
            elif isinstance(res, tuple) and len(res) == 2:
                stream_key, m3u_text = res
                session_id = ""
                status = "ok" if m3u_text else "starting"
            else:
                stream_key, session_id, m3u_text, status = f"{cid}_s{requested_server}", "", None, "starting"

            if stream_key:
                ON_DEMAND_STREAM_MANAGER.touch(stream_key)

            if status == "line_full":
                self.send_response(503)
                self.send_cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Retry-After", "5")
                self.end_headers()
                try:
                    self.wfile.write("خط الاشتراك مشغول حالياً بحد أقصى للقنوات المتزامنة. يرجى تجربة قناة أخرى أو المحاولة لاحقاً.".encode("utf-8"))
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return

            if not m3u_text:
                self.send_response(503)
                self.send_cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Retry-After", "2")
                self.end_headers()
                try:
                    self.wfile.write(b"Server Initializing Stream...")
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return

            # Strip any transient #EXT-X-ENDLIST so the player never stops polling or treats live stream as VOD
            m3u_text = re.sub(r"#EXT-X-ENDLIST\r?\n?", "", m3u_text)

            now_t = int(time.time())
            expires = now_t + SEGMENT_TOKEN_TTL

            extra_params = ""
            if qs.get("key"):
                extra_params += f"&key={urllib.parse.quote(qs.get('key')[0])}"
            if qs.get("bot"):
                extra_params += f"&bot={urllib.parse.quote(qs.get('bot')[0])}"

            rewritten = []
            for line in m3u_text.splitlines():
                l = line.strip()
                if not l or l.startswith("#EXT-X-ENDLIST"):
                    continue
                if l.startswith("#"):
                    rewritten.append(l)
                else:
                    seg_name = os.path.basename(l)
                    token = make_segment_token(stream_key, session_id, seg_name, expires)
                    if session_id:
                        rewritten.append(f"{base_origin}/live/segment/{stream_key}/{session_id}/{seg_name}?h={token}&exp={expires}{extra_params}")
                    else:
                        rewritten.append(f"{base_origin}/live/segment/{stream_key}/{seg_name}?h={token}&exp={expires}{extra_params}")

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
            seq_key = (cid, str(requested_server))
            prev_seq = channel_max_sequence.get(seq_key, 0)
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
                channel_max_sequence[seq_key] = curr_seq

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
                        enc_u = urllib.parse.quote(full_u, safe="")
                        enc_r = urllib.parse.quote(channel_referer or "", safe="")
                        return f'URI="{base_origin}/live/ts/chunk.ts?url={enc_u}&ref={enc_r}"'
                    rewritten.append(re.sub(r'URI="([^"]+)"', replace_uri, l))
                elif not l.startswith("#EXT-X-ENDLIST"):
                    rewritten.append(l)
            else:
                seg_full = urllib.parse.urljoin(target_fetch_url, l)
                if force_proxy:
                    encoded_seg = urllib.parse.quote(seg_full, safe="")
                    encoded_ref = urllib.parse.quote(channel_referer or "", safe="")
                    rewritten.append(f"{base_origin}/live/ts/chunk.ts?url={encoded_seg}&ref={encoded_ref}")
                else:
                    rewritten.append(seg_full)

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
                        host = self.headers.get("X-Forwarded-Host", self.headers.get("Host", f"127.0.0.1:{PORT}"))
                        proto = self.headers.get("X-Forwarded-Proto", "https" if ("railway" in host or "443" in host) else "http")
                        if "railway" in host:
                            proto = "https"
                        base_origin = f"{proto}://{host}"

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
                                        enc_r = urllib.parse.quote(referer or "", safe="")
                                        return f'URI="{base_origin}/live/ts/chunk.ts?url={enc_u}&ref={enc_r}"'
                                    rewritten.append(re.sub(r'URI="([^"]+)"', replace_sub_uri, l))
                                else:
                                    rewritten.append(l)
                            else:
                                seg_full = urllib.parse.urljoin(target_url, l)
                                encoded_seg = urllib.parse.quote(seg_full, safe="")
                                encoded_ref = urllib.parse.quote(referer or "", safe="")
                                rewritten.append(f"{base_origin}/live/ts/chunk.ts?url={encoded_seg}&ref={encoded_ref}")

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
    def handle_ondemand_segment(self, stream_key, seg_file, session_id=""):
        """Serves on-demand HLS sliced TS segment directly with Level 2 HMAC verification and RAM cache"""
        clean_key = re.sub(r"[^a-zA-Z0-9_\-]", "", stream_key)
        clean_file = re.sub(r"[^a-zA-Z0-9_\-\.]", "", seg_file)
        clean_session = re.sub(r"[^a-zA-Z0-9_\-]", "", session_id) if session_id else ""

        # Level 2 Security Check: Verify HMAC signature and expiration
        parsed_q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        token = parsed_q.get("h", [""])[0]
        exp_str = parsed_q.get("exp", [""])[0]

        if token and exp_str:
            valid, reason = verify_segment_token(clean_key, clean_session, clean_file, token, exp_str)
            if not valid:
                self.send_response(403)
                self.send_cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(f"403 Forbidden: {reason}".encode("utf-8"))
                return
        elif SECURITY_STRICT_TOKENS:
            self.send_response(403)
            self.send_cors_headers()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"403 Forbidden: Missing security signature.")
            return

        ON_DEMAND_STREAM_MANAGER.touch(stream_key)
        cache_key = f"{clean_key}_{clean_session}_{clean_file}" if clean_session else f"{clean_key}_{clean_file}"

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

        if clean_session and hasattr(ON_DEMAND_STREAM_MANAGER, "segment_path"):
            seg_path = ON_DEMAND_STREAM_MANAGER.segment_path(clean_key, clean_session, clean_file)
        else:
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
