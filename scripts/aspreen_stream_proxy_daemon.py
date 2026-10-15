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
import urllib.request
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Ensure UTF-8 and line-buffered output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)


WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DESKTOP_DIR = os.path.join(os.path.expanduser("~"), "Desktop")
DATA_DIR = os.path.join(WORKSPACE_DIR, "data")
CONFIG_FILE = os.path.join(WORKSPACE_DIR, "telegram_config.json")
CHANNELS_JSON_PATH = os.path.join(WORKSPACE_DIR, "channels.json")

PORT = 8080
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

# Geo-Bypass Headers
BYPASS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://yacine.website/",
    "X-Forwarded-For": "105.100.1.1",  # Algeria IP bypass (official licenser)
    "CF-Connecting-IP": "105.100.1.1",
    "X-Real-IP": "105.100.1.1",
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
    req = urllib.request.Request(api_url, headers=BYPASS_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode("utf-8", errors="ignore"))
            if data.get("status") == "success":
                raw_url = data.get("raw_url", "").strip()
                play_url = data.get("url", "").strip()
                ua = data.get("user_agent", "")

                with cache_lock:
                    if cid in channels_cache:
                        ch = channels_cache[cid]
                        if play_url:
                            ch["playUrl"] = f"https://yacine.website{play_url}"
                        if raw_url:
                            ch["streamUrl"] = raw_url
                            ch["directM3u8"] = raw_url
                        if ua:
                            ch["userAgent"] = ua
                        ch["status"] = "live"
                        ch["lastRenewed"] = time.time()
                return True
    except Exception:
        pass
    return False


def background_auto_renew_loop():
    """24/7 Background thread that renews all channels periodically"""
    global last_renew_time, total_refreshes
    time.sleep(5)  # initial wait

    while True:
        try:
            print(f"\n🔄 [{time.strftime('%H:%M:%S')}] بدء جولة التجديد التلقائي لروابط القنوات (24/7 Auto-Renew)...")
            start_round = time.time()
            with cache_lock:
                cids = list(channels_cache.keys())

            success_count = 0
            # Renew in parallel batches of 10
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=10) as executor:
                results = list(executor.map(renew_single_channel_stream, cids))
                success_count = sum(1 for r in results if r)

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
            root_m3u = os.path.join(WORKSPACE_DIR, "channels.m3u")
            if os.path.exists(root_m3u):
                with open(root_m3u, "rb") as f:
                    content = f.read()
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

        # 4. Proxy Segment Chunk: /ts?url=<encoded_url>
        if self.path.startswith("/ts?url="):
            target_url = urllib.parse.unquote(self.path[8:])
            if target_url:
                self.handle_ts_segment(target_url)
                return


        # Fallback 404
        self.send_response(404)
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(b"Not Found")

    def handle_channel_playlist(self, cid):
        """Fetches upstream M3U8, rewrites segment URLs, and returns to client"""
        with cache_lock:
            ch = channels_cache.get(cid)

        if not ch:
            # Try reloading from disk
            load_channels_from_disk()
            with cache_lock:
                ch = channels_cache.get(cid)

        if not ch:
            self.send_response(404)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Channel Not Found")
            return

        # Determine upstream URL
        play_url = ch.get("playUrl")
        stream_url = ch.get("streamUrl", "")
        ua = ch.get("userAgent", BYPASS_HEADERS["User-Agent"])

        if play_url and "play.php" in play_url:
            target_fetch_url = play_url
        elif "new-redirect.online" in stream_url:
            b64_url = base64.b64encode(stream_url.encode()).decode()
            b64_ua = base64.b64encode(ua.encode()).decode()
            target_fetch_url = f"https://yacine.website/play.php?url={b64_url}&ua={b64_ua}"
        else:
            target_fetch_url = stream_url

        if not target_fetch_url or target_fetch_url.startswith("http://127.0.0.1"):
            renew_single_channel_stream(cid)
            with cache_lock:
                ch = channels_cache.get(cid, {})
                target_fetch_url = ch.get("playUrl") or ch.get("streamUrl")


        if not target_fetch_url:
            self.send_response(502)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Upstream Unavailable")
            return

        # Fetch upstream M3U8 with appropriate headers
        req_headers = {"User-Agent": ua}
        if "yacine.website" in target_fetch_url:
            req_headers.update({
                "Referer": "https://yacine.website/",
                "X-Forwarded-For": "105.100.1.1",
                "CF-Connecting-IP": "105.100.1.1",
                "X-Real-IP": "105.100.1.1"
            })

        def fetch_m3u(url, headers):
            try:
                r = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(r, timeout=6) as resp:
                    return resp.read().decode("utf-8", errors="ignore")
            except Exception:
                return ""

        m3u_text = fetch_m3u(target_fetch_url, req_headers)

        if not m3u_text or "#EXTM3U" not in m3u_text or "No URLs available" in m3u_text:
            # Token might be stale - trigger immediate fresh token renewal
            renew_single_channel_stream(cid)
            with cache_lock:
                ch = channels_cache.get(cid, {})
                target_fetch_url = ch.get("playUrl") or ch.get("streamUrl", "")
            if target_fetch_url:
                if "yacine.website" in target_fetch_url:
                    req_headers.update({
                        "Referer": "https://yacine.website/",
                        "X-Forwarded-For": "105.100.1.1",
                        "CF-Connecting-IP": "105.100.1.1",
                        "X-Real-IP": "105.100.1.1"
                    })
                m3u_text = fetch_m3u(target_fetch_url, req_headers)

        if not m3u_text or "#EXTM3U" not in m3u_text:
            print(f" [!] Channel {cid} playlist fetch failed. target_url: {target_fetch_url} | text: {m3u_text[:80]}")
            self.send_response(502)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b"No Playlist Data")
            return



        # Rewrite Playlist: route relative TS segments through /ts?url=...
        host = self.headers.get("Host", f"127.0.0.1:{PORT}")
        base_origin = f"http://{host}"

        lines = m3u_text.splitlines()
        rewritten = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#"):
                rewritten.append(line)
            else:
                # Segment URL line
                if line.startswith("http://") or line.startswith("https://"):
                    seg_full = line
                elif line.startswith("/"):
                    seg_full = f"https://yacine.website{line}"
                else:
                    seg_full = f"https://yacine.website/{line}"

                encoded_seg = urllib.parse.quote(seg_full, safe="")
                rewritten_seg = f"{base_origin}/ts?url={encoded_seg}"
                rewritten.append(rewritten_seg)

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

    def handle_ts_segment(self, target_url):
        """Pipes upstream TS segment chunks to client seamlessly"""
        headers = dict(BYPASS_HEADERS)
        if "edgenextcdn.net" in target_url:
            headers.pop("Referer", None)
            headers.pop("X-Forwarded-For", None)
            headers.pop("CF-Connecting-IP", None)
            headers.pop("X-Real-IP", None)

        req = urllib.request.Request(target_url, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=8) as upstream:
                status = upstream.getcode()
                content_len = upstream.headers.get("Content-Length")
                self.send_response(status)
                self.send_cors_headers()
                self.send_header("Content-Type", "video/mp2t")
                if content_len:
                    self.send_header("Content-Length", content_len)
                self.end_headers()

                # Stream buffer chunks
                while True:
                    chunk = upstream.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except Exception:
            try:
                self.send_response(502)
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
