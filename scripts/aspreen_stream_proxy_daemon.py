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

# Video Processing & Broadcast Transcoding Configuration (TVARUA Stream Branding)
LOGO_PATHS = [
    os.path.join(WORKSPACE_DIR, "tvarua_logo_clean_alpha.png"),
    os.path.join(WORKSPACE_DIR, "data", "tvarua_logo.png"),
    os.path.join(WORKSPACE_DIR, "tvarua_logo.png"),
    os.path.join(WORKSPACE_DIR, "apps", "web", "public", "tvarua_logo_clean_alpha.png"),
    os.path.join(WORKSPACE_DIR, "apps", "web", "public", "tvarua_logo.png"),
]
EFFECTIVE_LOGO_PATH = next((p for p in LOGO_PATHS if os.path.exists(p)), "")
HLS_DATA_DIR = os.path.join(DATA_DIR, "hls")
os.makedirs(HLS_DATA_DIR, exist_ok=True)

class LiveTranscoderManager:
    """
    Manages background FFmpeg live transcoding process for the active stream.
    Burns TVARUA metallic logo directly into video frames at bottom-left,
    completely covering Yacine TV watermarks while preserving beIN Sports logos.
    Guarantees 100% CPU dedication to the single active channel being watched.
    """
    def __init__(self):
        self.active_cid = "207119423132628321"  # Default primary channel (beIN SPORTS 1)
        self.procs = {}                         # cid -> subprocess.Popen
        self.proc_start_time = {}              # cid -> timestamp
        self.last_access = {}                   # cid -> timestamp
        self.log_files = {}                     # cid -> file handle
        self.lock = threading.Lock()

    def ensure_transcoder(self, cid: str):
        with self.lock:
            now = time.time()
            self.last_access[cid] = now
            self.active_cid = cid

            # Terminate ANY other channel transcoders to dedicate 100% CPU exclusively to this channel!
            for other_cid, other_proc in list(self.procs.items()):
                if other_cid != cid:
                    if other_proc and other_proc.poll() is None:
                        try:
                            other_proc.terminate()
                            print(f" [i] إيقاف معالج القناة السابقة {other_cid} لتفريغ المعالج 100% للقناة النشطة {cid}")
                        except Exception:
                            pass
                    self.procs.pop(other_cid, None)
                    old_log = self.log_files.pop(other_cid, None)
                    if old_log:
                        try:
                            old_log.close()
                        except Exception:
                            pass

            proc = self.procs.get(cid)
            out_dir = os.path.join(HLS_DATA_DIR, cid)
            out_m3u8 = os.path.join(out_dir, "live.m3u8")
            start_t = self.proc_start_time.get(cid, 0)

            # Check if already running and active
            if proc is not None and proc.poll() is None:
                # If started recently (< 25s), give it time to buffer initial segments
                if (now - start_t) < 25:
                    return
                # If running longer, verify out_m3u8 is updating
                if os.path.exists(out_m3u8) and (now - os.path.getmtime(out_m3u8)) < 25:
                    return  # Completely healthy and active!
                # If stale (> 25s without updating m3u8), terminate and restart
                try:
                    proc.terminate()
                except Exception:
                    pass
                self.procs.pop(cid, None)

            # Clean up old log file handle if open
            old_log = self.log_files.pop(cid, None)
            if old_log:
                try:
                    old_log.close()
                except Exception:
                    pass

            os.makedirs(out_dir, exist_ok=True)
            # Only purge stale files if m3u8 is dead/stale or starting fresh
            if not os.path.exists(out_m3u8) or (now - os.path.getmtime(out_m3u8)) > 30:
                for old_f in os.listdir(out_dir):
                    if old_f.endswith(".ts") or old_f.endswith(".m3u8"):
                        try:
                            os.remove(os.path.join(out_dir, old_f))
                        except Exception:
                            pass

            logo = EFFECTIVE_LOGO_PATH
            if not logo or not os.path.exists(logo):
                logo = next((p for p in LOGO_PATHS if os.path.exists(p)), "")

            filter_str = (
                "[0:v]delogo=x=18:y=594:w=135:h=118[clean];"
                "[1:v]scale=125:-1[logo];"
                "[clean][logo]overlay=22:main_h-overlay_h-22[outv]"
            ) if (logo and os.path.exists(logo)) else (
                "[0:v]delogo=x=18:y=594:w=135:h=118[outv]"
            )

            raw_input = f"http://127.0.0.1:{PORT}/raw/{cid}.m3u8"
            cmd = [
                "ffmpeg", "-y",
                "-fflags", "+nobuffer+genpts+discardcorrupt",
                "-rw_timeout", "15000000",
                "-allowed_extensions", "ALL",
                "-i", raw_input,
            ]
            if logo and os.path.exists(logo):
                cmd.extend(["-i", logo])

            cmd.extend([
                "-filter_complex", filter_str,
                "-map", "[outv]",
                "-map", "0:a?",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-tune", "zerolatency",
                "-r", "25",
                "-g", "50",
                "-keyint_min", "25",
                "-sc_threshold", "0",
                "-b:v", "1800k",
                "-maxrate", "2200k",
                "-bufsize", "3600k",
                "-c:a", "aac",
                "-b:a", "128k",
                "-ar", "44100",
                "-af", "aresample=async=1000",
                "-f", "hls",
                "-hls_time", "3",
                "-hls_list_size", "8",
                "-hls_flags", "delete_segments+omit_endlist+independent_segments",
                "-hls_segment_filename", os.path.join(out_dir, "chunk_%05d.ts"),
                out_m3u8
            ])

            print(f" [★] تشغيل معالج البث فائق الاستقرار (Live Transcoder) للقناة {cid} مع حرق لوجو TVARUA داخل إطارات البث...")
            try:
                log_path = os.path.join(out_dir, "ffmpeg.log")
                lf = open(log_path, "w", encoding="utf-8", errors="ignore")
                self.log_files[cid] = lf
                p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=lf)
                self.procs[cid] = p
                self.proc_start_time[cid] = now
            except Exception as e:
                print(f" [!] خطأ في تشغيل معالج البث للقناة {cid}: {e}")

    def supervisor_tick(self):
        """Active supervisor keeping ONLY the currently active channel transcoding smoothly"""
        now = time.time()
        with self.lock:
            cid = self.active_cid or "207119423132628321"
            proc = self.procs.get(cid)
            out_m3u8 = os.path.join(HLS_DATA_DIR, cid, "live.m3u8")
            start_t = self.proc_start_time.get(cid, 0)

            # If active channel process died:
            if proc is None or proc.poll() is not None:
                print(f" [⚡] استئناف وإعادة تشغيل معالج البث للقناة النشطة {cid}...")
                threading.Thread(target=self.ensure_transcoder, args=(cid,), daemon=True).start()
            elif (now - start_t) > 25:
                # Running for > 25s, verify it is writing fresh segments
                if not os.path.exists(out_m3u8) or (now - os.path.getmtime(out_m3u8)) > 25:
                    print(f" [⚡] تجديد معالج البث للقناة النشطة {cid}...")
                    threading.Thread(target=self.ensure_transcoder, args=(cid,), daemon=True).start()

transcoder_mgr = LiveTranscoderManager()

def transcoder_supervisor_loop():
    """Background supervisor for live stream transcoding health & 100% uptime"""
    time.sleep(5)
    while True:
        try:
            transcoder_mgr.supervisor_tick()
        except Exception:
            pass
        time.sleep(5)


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
            proto = self.headers.get("X-Forwarded-Proto", "https" if ("railway" in host or "443" in host) else "http")
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

        # 3. Raw Channel Playlist (for local FFmpeg ingest): /raw/<channel_id>.m3u8
        match_raw = re.match(r"^/raw/(\d+)\.m3u8$", path)
        if match_raw:
            cid = match_raw.group(1)
            self.handle_channel_playlist(cid, is_raw=True)
            return

        # 4. Live Channel Playlist: /live/<channel_id>.m3u8 (with hardcoded TVARUA logo burned in video frames)
        match_live = re.match(r"^/live/(\d+)\.m3u8$", path)
        if match_live:
            cid = match_live.group(1)
            hls_dir = os.path.join(HLS_DATA_DIR, cid)
            live_m3u8_file = os.path.join(hls_dir, "live.m3u8")
            transcoder_mgr.ensure_transcoder(cid)

            # Wait up to 7.5s on cold start so client always receives branded stream with logo
            for _ in range(25):
                if os.path.exists(live_m3u8_file):
                    ts_chunks = [f for f in os.listdir(hls_dir) if f.endswith(".ts")]
                    if len(ts_chunks) >= 1:
                        if (time.time() - os.path.getmtime(live_m3u8_file)) < 25:
                            break
                time.sleep(0.3)

            # If live branded HLS is ready on disk with chunks, serve it directly
            if os.path.exists(live_m3u8_file):
                ts_chunks = [f for f in os.listdir(hls_dir) if f.endswith(".ts")]
                if len(ts_chunks) >= 1:
                    try:
                        with open(live_m3u8_file, "r", encoding="utf-8") as f:
                            m3u_lines = f.read().splitlines()
                        rewritten = []
                        for line in m3u_lines:
                            if line.endswith(".ts") and not line.startswith("http") and not line.startswith("/"):
                                rewritten.append(f"/live/{cid}/{line}")
                            else:
                                rewritten.append(line)
                        out_body = ("\n".join(rewritten) + "\n").encode("utf-8")
                        self.send_response(200)
                        self.send_cors_headers()
                        self.send_header("Content-Type", "application/vnd.apple.mpegurl")
                        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                        self.send_header("Pragma", "no-cache")
                        self.send_header("Expires", "0")
                        self.send_header("Content-Length", str(len(out_body)))
                        self.end_headers()
                        self.wfile.write(out_body)
                        return
                    except Exception:
                        pass

            # Fallback only during transient cold start
            self.handle_channel_playlist(cid, is_raw=False)
            return

        # 4b. Live Debug Log Endpoint: /live/<channel_id>/debug.log
        match_log = re.match(r"^/live/(\d+)/debug\.log$", path)
        if match_log:
            cid = match_log.group(1)
            log_path = os.path.join(HLS_DATA_DIR, cid, "ffmpeg.log")
            if os.path.exists(log_path):
                with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                    log_content = f.read()[-8000:].encode("utf-8")
                self.send_response(200)
                self.send_cors_headers()
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(log_content)))
                self.end_headers()
                self.wfile.write(log_content)
                return
            self.send_response(404)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b"No log file found")
            return

        # 5. Live Transcoded Segment Chunks (from disk): /live/<channel_id>/chunk_XXXXX.ts
        match_chunk = re.match(r"^/live/(\d+)/(chunk_\d+\.ts)$", path)
        if match_chunk:
            cid = match_chunk.group(1)
            chunk_name = match_chunk.group(2)
            chunk_path = os.path.join(HLS_DATA_DIR, cid, chunk_name)
            if os.path.exists(chunk_path):
                try:
                    with open(chunk_path, "rb") as f:
                        chunk_data = f.read()
                    self.send_response(200)
                    self.send_cors_headers()
                    self.send_header("Content-Type", "video/mp2t")
                    self.send_header("Content-Length", str(len(chunk_data)))
                    self.send_header("Cache-Control", "public, max-age=60")
                    self.end_headers()
                    self.wfile.write(chunk_data)
                    return
                except (BrokenPipeError, ConnectionResetError):
                    return
                except Exception:
                    pass
            self.send_response(404)
            self.send_cors_headers()
            self.end_headers()
            return

        # 6. Proxy Segment Chunk: /ts or /live/ts or /raw/ts
        if self.path.startswith("/ts?") or self.path.startswith("/live/ts?") or self.path.startswith("/raw/ts?") or self.path.startswith("/ts/") or self.path.startswith("/live/ts/") or self.path.startswith("/raw/ts/"):
            parsed_ts = urllib.parse.urlparse(self.path)
            qs_ts = urllib.parse.parse_qs(parsed_ts.query)
            target_url = qs_ts.get("url", [""])[0]
            ref_override = qs_ts.get("ref", [""])[0]
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

    def handle_channel_playlist(self, cid, is_raw=False):
        """Fetches upstream M3U8, rewrites segment URLs, and returns to client"""
        now_ts = time.time()
        cache_key = f"{cid}_raw" if is_raw else cid
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

        def build_target_and_ua(channel_obj):
            play_url = channel_obj.get("playUrl", "")
            stream_url = channel_obj.get("streamUrl", "")
            ua_candidate = channel_obj.get("userAgent", "")

            # Always prefer playUrl because upstream direct streamUrl (new-redirect.online) returns 403 Forbidden!
            if play_url and "play.php" in play_url:
                target = play_url
            elif "new-redirect.online" in stream_url:
                b64_url = base64.b64encode(stream_url.encode()).decode()
                ua_for_param = ua_candidate or DEFAULT_UA
                b64_ua = base64.b64encode(ua_for_param.encode()).decode()
                target = f"https://yacine.website/play.php?url={b64_url}&ua={b64_ua}"
            elif play_url:
                target = play_url
            else:
                target = stream_url

            # Extract exact UA if encoded in query string
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

        target_fetch_url, req_ua = build_target_and_ua(ch)

        # Only trigger renewal if we have no target stream url at all
        if not target_fetch_url or target_fetch_url.startswith("http://127.0.0.1"):
            renew_single_channel_stream(cid)
            with cache_lock:
                ch = channels_cache.get(cid, {})
                target_fetch_url, req_ua = build_target_and_ua(ch)

        if not target_fetch_url:
            self.send_response(502)
            self.send_cors_headers()
            self.end_headers()
            try:
                self.wfile.write(b"Upstream Unavailable")
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
                    with PROXY_OPENER.open(r, timeout=3.5) as resp:
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
                    target_fetch_url, req_ua = build_target_and_ua(ch)
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

        # Extract query token from target_fetch_url if present (e.g. t=...&e=...)
        stream_query_token = ""
        if "?" in target_fetch_url:
            stream_query_token = target_fetch_url.split("?", 1)[1]

        # Parse playlist: isolate headers and active live segment pairs
        header_lines = []
        seg_pairs = []
        curr_inf = None
        media_seq = None

        lines = m3u_text.splitlines()
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#EXT-X-MEDIA-SEQUENCE:"):
                try:
                    media_seq = int(line.split(":")[1])
                except Exception:
                    pass
                continue
            if line.startswith("#EXTINF"):
                curr_inf = line
            elif not line.startswith("#") and curr_inf:
                seg_pairs.append((curr_inf, line))
                curr_inf = None
            else:
                header_lines.append(line)

        rewritten = []
        for h in header_lines:
            if 'URI="' in h:
                def replace_uri(m):
                    u = m.group(1)
                    full_u = urllib.parse.urljoin(target_fetch_url, u)
                    enc_u = urllib.parse.quote(full_u, safe="")
                    enc_r = urllib.parse.quote(channel_referer, safe="")
                    return f'URI="/live/ts/chunk.ts?url={enc_u}&ref={enc_r}"'
                rewritten.append(re.sub(r'URI="([^"]+)"', replace_uri, h))
            else:
                rewritten.append(h)

        if media_seq is not None:
            last_seq = channel_max_sequence.get(cid, 0)
            if media_seq < last_seq:
                media_seq = last_seq
            else:
                channel_max_sequence[cid] = media_seq
            # Place media sequence right after #EXTM3U
            idx = 1 if len(rewritten) > 0 and rewritten[0].startswith("#EXTM3U") else 0
            rewritten.insert(idx, f"#EXT-X-MEDIA-SEQUENCE:{media_seq}")

        for inf, seg_url in seg_pairs:
            # Resolve relative segment URL against playlist URL
            seg_full = urllib.parse.urljoin(target_fetch_url, seg_url)

            # If it's a raw new-redirect.online url without play.php, wrap it
            if "new-redirect.online" in seg_full and "play.php" not in seg_full:
                b64_url = base64.b64encode(seg_full.encode()).decode()
                b64_ua = base64.b64encode((req_ua or DEFAULT_UA).encode()).decode()
                seg_full = f"https://yacine.website/play.php?url={b64_url}&ua={b64_ua}"

            encoded_seg = urllib.parse.quote(seg_full, safe="")
            encoded_ref = urllib.parse.quote(channel_referer, safe="")
            rewritten.append(inf)
            rewritten.append(f"/live/ts/chunk.ts?url={encoded_seg}&ref={encoded_ref}")

        out_body = ("\n".join(rewritten) + "\n").encode("utf-8")
        with m3u8_cache_lock:
            m3u8_cache[cache_key] = (out_body, time.time() + 3.0)
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

        for attempt in range(2):
            try:
                req = urllib.request.Request(target_url, headers=headers)
                with PROXY_OPENER.open(req, timeout=6) as upstream:
                    first_chunk = upstream.read(64 * 1024)
                    if not first_chunk or first_chunk.startswith(b"No URLs available") or first_chunk.startswith(b"<html>") or first_chunk.startswith(b"<html") or first_chunk.startswith(b"<!DOCTYPE"):
                        if attempt < 1:
                            headers["Referer"] = "https://yacine.website/"
                            time.sleep(0.3)
                            continue
                        # Return empty TS segment with 200 to prevent HLS.js crashing on expired live segments
                        self.send_response(200)
                        self.send_cors_headers()
                        self.send_header("Content-Type", "video/mp2t")
                        self.send_header("Content-Length", "0")
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
                        while True:
                            chunk = upstream.read(64 * 1024)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        return
                    return
            except (BrokenPipeError, ConnectionResetError):
                # Client disconnected or seeked in player - normal in live streaming
                return
            except Exception as e:
                if attempt < 2:
                    time.sleep(0.5)
                    continue
                try:
                    self.send_response(502)
                    self.end_headers()
                except Exception:
                    pass
                return



def start_server():
    """Starts the 24/7 multi-threaded HTTP proxy server"""
    load_channels_from_disk()

    # Launch background worker for periodic auto-renew
    t_worker = threading.Thread(target=background_auto_renew_loop, daemon=True)
    t_worker.start()

    # Launch background live stream transcoder supervisor (burns TVARUA logo into video frames 24/7)
    t_transcoder = threading.Thread(target=transcoder_supervisor_loop, daemon=True)
    t_transcoder.start()

    # Pre-start live transcoder for primary channel (beIN SPORTS 1) to ensure immediate instant playback
    def pre_warm():
        time.sleep(2)
        print(" [🚀] بدء المعالجة الحية المسبقة للقناة beIN SPORTS 1 لضمان توفر البث فوراً بدون تأخير...")
        transcoder_mgr.ensure_transcoder("207119423132628321")

    t_warm = threading.Thread(target=pre_warm, daemon=True)
    t_warm.start()

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
