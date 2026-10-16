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
import ssl
import urllib.request
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Unverified SSL context for upstream IPTV streams with self-signed or expired certs
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

# Ensure UTF-8 and line-buffered output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)


WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DESKTOP_DIR = os.path.join(os.path.expanduser("~"), "Desktop")
DATA_DIR = os.path.join(WORKSPACE_DIR, "data")
CONFIG_FILE = os.path.join(WORKSPACE_DIR, "telegram_config.json")
CHANNELS_JSON_PATH = os.path.join(WORKSPACE_DIR, "channels.json")

PORT = int(os.environ.get("STREAM_PROXY_PORT", os.environ.get("PORT", "8088")))
AUTO_RENEW_INTERVAL_SECONDS = 30 * 60  # Renew every 30 minutes
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
    "CF-Connecting-IP": "156.200.1.1",
    "X-Real-IP": "156.200.1.1",
    "Accept": "*/*"
}

# Global In-Memory State
channels_cache = {}  # cid -> channel dict
cache_lock = threading.Lock()
server_start_time = time.time()
last_renew_time = 0
total_refreshes = 0


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
            with cache_lock:
                for ch in data:
                    cid = str(ch.get("id") or ch.get("vid"))
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



def background_auto_renew_loop():
    """24/7 Background thread that renews all channels periodically"""
    global last_renew_time, total_refreshes
    time.sleep(15)  # Wait 15s for server startup, then perform initial refresh

    while True:
        try:
            print(f"\n🔄 [{time.strftime('%H:%M:%S')}] بدء جولة التجديد التلقائي لروابط القنوات (24/7 Auto-Renew)...")
            start_round = time.time()
            with cache_lock:
                cids = list(channels_cache.keys())

            success_count = 0
            for cid in cids:
                with cache_lock:
                    ch_info = channels_cache.get(cid, {})
                    stream_url = ch_info.get("streamUrl", "")
                    ch_source = ch_info.get("source", "")
                
                # Renew dynamic yacine event streams; NEVER overwrite dedicated CDN channels like edgenextcdn
                if (ch_source == "yacine.website" or len(cid) >= 15) and "edgenextcdn.net" not in stream_url:
                    if renew_single_channel_stream(cid):
                        success_count += 1
                    time.sleep(0.08)


            last_renew_time = time.time()
            total_refreshes += 1
            round_duration = round(time.time() - start_round, 1)

            print(f" [✓] اكتملت جولة التجديد: تم تحديث {success_count}/{len(cids)} قناة في {round_duration} ثانية.")

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

        # 3. Live Channel Playlist: /live/<channel_id>.m3u8
        match = re.match(r"^/live/(\d+)\.m3u8$", path)
        if match:
            cid = match.group(1)
            self.handle_channel_playlist(cid)
            return

        # 4. Proxy Segment Chunk: /ts or /live/ts
        if self.path.startswith("/ts?") or self.path.startswith("/live/ts?") or self.path.startswith("/ts/") or self.path.startswith("/live/ts/"):
            parsed_ts = urllib.parse.urlparse(self.path)
            qs_ts = urllib.parse.parse_qs(parsed_ts.query)
            target_url = qs_ts.get("url", [""])[0]
            ref_override = qs_ts.get("ref", [""])[0]
            if not target_url and self.path.startswith("/ts?url="):
                target_url = urllib.parse.unquote(self.path[8:])
            elif not target_url and self.path.startswith("/live/ts?url="):
                target_url = urllib.parse.unquote(self.path[13:])
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

    def handle_channel_playlist(self, cid):
        """Fetches upstream M3U8, rewrites segment URLs, and returns to client"""
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
        now = time.time()
        last_renewed = ch.get("lastRenewed", 0)
        is_dynamic_yacine = (ch.get("source") == "yacine.website" or len(cid) >= 15) and "edgenextcdn.net" not in target_fetch_url

        # Tokens are valid for 5 hours; renew dynamic streams every 30 minutes to stay fresh
        if is_dynamic_yacine and (now - last_renewed > 1800 or not target_fetch_url or target_fetch_url.startswith("http://127.0.0.1")):
            renew_single_channel_stream(cid)
            with cache_lock:
                ch = channels_cache.get(cid, {})
                target_fetch_url, req_ua = build_target_and_ua(ch)

        if not target_fetch_url:
            if renew_single_channel_stream(cid):
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

        def fetch_m3u(url, user_agent, max_retries=3):
            headers = {
                "User-Agent": user_agent or DEFAULT_UA,
                "Referer": channel_referer,
                "Accept": "*/*"
            }
            if "edgenextcdn.net" in url:
                headers.pop("Referer", None)
            elif "yacine.website" in url or "new-redirect.online" in url:
                headers["X-Forwarded-For"] = "105.100.1.1"
                headers["CF-Connecting-IP"] = "105.100.1.1"
                headers["X-Real-IP"] = "105.100.1.1"

            for attempt in range(max_retries):
                try:
                    r = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(r, timeout=10, context=SSL_CTX) as resp:
                        content = resp.read().decode("utf-8", errors="ignore")
                        if "#EXTM3U" in content:
                            return content
                        # Token propagation delay: wait 0.5s and retry
                        if ("No URLs available" in content or not content) and attempt < max_retries - 1:
                            time.sleep(0.5)
                            continue
                        return content
                except Exception as e:
                    if attempt < max_retries - 1:
                        time.sleep(0.5)
                        continue
            return ""

        m3u_text = fetch_m3u(target_fetch_url, req_ua)

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

        # In live streams, keep only the latest 4 active segments so players never request expired chunks
        if len(seg_pairs) > 4:
            discarded = len(seg_pairs) - 4
            seg_pairs = seg_pairs[-4:]
            if media_seq is not None:
                media_seq += discarded

        rewritten = []
        for h in header_lines:
            if 'URI="' in h:
                def replace_uri(m):
                    u = m.group(1)
                    full_u = urllib.parse.urljoin(target_fetch_url, u)
                    enc_u = urllib.parse.quote(full_u, safe="")
                    enc_r = urllib.parse.quote(channel_referer, safe="")
                    return f'URI="/live/ts?url={enc_u}&ref={enc_r}"'
                rewritten.append(re.sub(r'URI="([^"]+)"', replace_uri, h))
            else:
                rewritten.append(h)

        if media_seq is not None:
            # Place media sequence right after #EXTM3U
            idx = 1 if len(rewritten) > 0 and rewritten[0].startswith("#EXTM3U") else 0
            rewritten.insert(idx, f"#EXT-X-MEDIA-SEQUENCE:{media_seq}")

        for inf, seg_url in seg_pairs:
            seg_full = urllib.parse.urljoin(target_fetch_url, seg_url)
            encoded_seg = urllib.parse.quote(seg_full, safe="")
            encoded_ref = urllib.parse.quote(channel_referer, safe="")
            rewritten.append(inf)
            rewritten.append(f"/live/ts?url={encoded_seg}&ref={encoded_ref}")

        out_body = ("\n".join(rewritten) + "\n").encode("utf-8")
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
            "Accept": "*/*"
        }
        if "edgenextcdn.net" in target_url:
            headers.pop("Referer", None)
        elif "yacine.website" in target_url or "new-redirect.online" in target_url:
            headers["X-Forwarded-For"] = "105.100.1.1"
            headers["CF-Connecting-IP"] = "105.100.1.1"
            headers["X-Real-IP"] = "105.100.1.1"

        req = urllib.request.Request(target_url, headers=headers)

        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=10, context=SSL_CTX) as upstream:
                    first_chunk = upstream.read(64 * 1024)
                    if not first_chunk or first_chunk.startswith(b"No URLs available") or first_chunk.startswith(b"<html>") or first_chunk.startswith(b"<html") or first_chunk.startswith(b"<!DOCTYPE"):
                        if attempt < 2:
                            time.sleep(0.4)
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
                                        return f'URI="/live/ts?url={enc_u}&ref={enc_r}"'
                                    rewritten.append(re.sub(r'URI="([^"]+)"', replace_sub_uri, l))
                                else:
                                    rewritten.append(l)
                            else:
                                seg_full = urllib.parse.urljoin(target_url, l)
                                encoded_seg = urllib.parse.quote(seg_full, safe="")
                                encoded_ref = urllib.parse.quote(referer, safe="")
                                rewritten.append(f"/live/ts?url={encoded_seg}&ref={encoded_ref}")

                        out_body = ("\n".join(rewritten) + "\n").encode("utf-8")
                        self.send_response(200)
                        self.send_cors_headers()
                        self.send_header("Content-Type", "application/vnd.apple.mpegurl")
                        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                        self.send_header("Content-Length", str(len(out_body)))
                        self.end_headers()
                        self.wfile.write(out_body)
                        return

                    status = upstream.getcode()
                    content_len = upstream.headers.get("Content-Length")
                    self.send_response(status)
                    self.send_cors_headers()
                    self.send_header("Content-Type", "video/mp2t")
                    if content_len:
                        self.send_header("Content-Length", content_len)
                    self.end_headers()

                    self.wfile.write(first_chunk)
                    while True:
                        chunk = upstream.read(64 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                    return
            except (BrokenPipeError, ConnectionResetError):
                # Client disconnected or seeked in player - normal in live streaming
                return
            except Exception as e:
                if attempt < 2:
                    time.sleep(0.8)
                    continue
                print(f" [!] TS Segment exception for {target_url[:60]}: {e}")
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
