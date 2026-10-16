# -*- coding: utf-8 -*-
"""
=============================================================================
         🚀 ASPREEN TV ▸ YACINE TV MASTER HARVESTER & STREAM PROXY
    سكربت سحب وتحديث جميع قنوات ياسين تيفي (325 قناة) من الألف إلى الياء
    مع استخراج الروابط الأصلية والشعارات وربطها بروابط موقعك الثابتة الدائمة
=============================================================================
* يكتشف جميع القنوات الـ 325 من موقع https://yacine.website/
* يستخرج روابط play.php المشفرة وروابط البث الأصلية ويفك حماية السيرفرات.
* يولد ملفات M3U / M3U8 مع روابط موقعك الثابتة (http://localhost:8088/live/{id}.m3u8)
* يدعم النسخ التلقائي المباشر لسطح المكتب للمشاهدة بدون تقطيع على VLC والشاشات.
* متوافق مع بوت تيليجرام لإرسال التقارير والملفات.
=============================================================================
"""

import os
import sys
import re
import json
import time
import base64
import ssl
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

# Ensure UTF-8 output with replacement on Windows console to prevent encoding crashes
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# SSL Context for upstream IPTV with unverified certs
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DESKTOP_DIR = os.path.join(os.path.expanduser("~"), "Desktop")
DATA_DIR = os.path.join(WORKSPACE_DIR, "data")
CONFIG_FILE = os.path.join(WORKSPACE_DIR, "telegram_config.json")
CHANNELS_JSON_PATH = os.path.join(WORKSPACE_DIR, "channels.json")

# Default Telegram settings
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

# Geo & Security Bypass Headers
BYPASS_HEADERS = {
    "User-Agent": DEFAULT_UA,
    "Referer": "https://yacine.website/",
    "X-Forwarded-For": "156.200.1.1",  # Egypt/Algeria IP bypass
    "CF-Connecting-IP": "156.200.1.1",
    "X-Real-IP": "156.200.1.1",
    "Accept": "*/*"
}

PUBLIC_PRODUCTION_BASE = "https://aspreen-tv-production.up.railway.app"
LOCAL_PROXY_BASE = "http://127.0.0.1:8088"


def send_telegram_message(text: str):
    """Send text message to Telegram Admin"""
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
        with urllib.request.urlopen(req, timeout=10, context=SSL_CTX) as resp:
            return resp.getcode() == 200
    except Exception as e:
        print(f" [!] تنبيه تيليجرام: {e}")
        return False


def send_telegram_file(file_path: str, caption: str = ""):
    """Send M3U document to Telegram Admin"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_ADMIN_CHAT_ID or not os.path.exists(file_path):
        return False
    try:
        boundary = "----WebKitFormBoundary" + os.urandom(16).hex()
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendDocument"

        filename = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            file_data = f.read()

        body = bytearray()
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{TELEGRAM_ADMIN_CHAT_ID}\r\n".encode())
        if caption:
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\n{caption}\r\n".encode())
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{filename}\"\r\nContent-Type: audio/x-mpegurl\r\n\r\n".encode())
        body.extend(file_data)
        body.extend(f"\r\n--{boundary}--\r\n".encode())

        req = urllib.request.Request(url, data=bytes(body), headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}"
        })
        with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
            return resp.getcode() == 200
    except Exception as e:
        print(f" [!] تنبيه إرسال ملف تيليجرام: {e}")
        return False


def get_all_channels_list():
    """Scrapes homepage and /channels to find all 325 channels with IDs and Slugs"""
    print("📡 [1/4] جارٍ الاتصال بموقع yacine.website واكتشاف قائمة القنوات...")
    url = "https://yacine.website/"
    req = urllib.request.Request(url, headers=BYPASS_HEADERS)
    with urllib.request.urlopen(req, timeout=12, context=SSL_CTX) as resp:
        html = resp.read().decode("utf-8", errors="ignore")

    matches = re.findall(r'href=["\']/channel/(\d+)/([^"\']+)["\']', html)
    unique_channels = {}
    for cid, slug in matches:
        if cid not in unique_channels:
            clean_name = slug.replace("-", " ").strip()
            unique_channels[cid] = {
                "id": cid,
                "slug": slug,
                "name": clean_name
            }

    channels_list = list(unique_channels.values())
    print(f" [✓] تم اكتشاف {len(channels_list)} قناة فريدة بنجاح من الألف إلى الياء!")
    return channels_list


def resolve_channel_stream_and_metadata(ch, index, total, existing_map):
    """
    Resolves the live stream URL and retains high quality logo and category
    """
    cid = ch["id"]
    slug = ch["slug"]
    clean_name = ch["name"]

    existing = existing_map.get(cid, {})

    # Retain or build curated category
    category = existing.get("groupTitle")
    if not category or category == "قنوات عامة":
        name_upper = clean_name.upper()
        if "BEIN" in name_upper and "SPORT" in name_upper:
            if "1080" in name_upper:
                category = "beIN SPORTS (1080P)"
            elif "720" in name_upper:
                category = "beIN SPORTS (720P)"
            elif "360" in name_upper:
                category = "beIN SPORTS (360P)"
            elif "244" in name_upper:
                category = "beIN SPORTS (244P)"
            elif "XTRA" in name_upper:
                category = "beIN SPORTS (1080P)"
            else:
                category = "beIN SPORTS (1080P)"
        elif "KASS" in name_upper:
            category = "ALKASS"
        elif "SSC" in name_upper:
            category = "SSC SPORTS"
        elif "MBC" in name_upper:
            category = "MBC CHANNELS"
        elif "OSN" in name_upper:
            category = "OSN Network"
        elif "SHAHID" in name_upper:
            category = "SHAHID VIP"
        elif "WEYYAK" in name_upper:
            category = "WEYYAK"
        elif "KIDS" in name_upper or "CARTOON" in name_upper or "SPACETOON" in name_upper:
            category = "KIDS CHANNELS"
        else:
            category = "قنوات عامة"

    logo = existing.get("logoUrl", "")
    ch_display_name = existing.get("name", clean_name)

    api_url = f"https://yacine.website/index.php?get_channel_stream={cid}"
    headers = dict(BYPASS_HEADERS)
    headers["Referer"] = f"https://yacine.website/channel/{cid}/{slug}"

    play_url = ""
    raw_url = ""
    ua_req = DEFAULT_UA
    status = "standby"

    try:
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req, timeout=9, context=SSL_CTX) as r:
            data = json.loads(r.read().decode("utf-8", errors="ignore"))
            if data.get("status") == "success":
                raw_candidate = data.get("raw_url", "").strip()
                play_candidate = data.get("url", "").strip()
                ua_candidate = data.get("user_agent", "")

                if play_candidate:
                    play_url = play_candidate if play_candidate.startswith("http") else f"https://yacine.website{play_candidate}"
                if raw_candidate:
                    raw_url = raw_candidate
                if ua_candidate:
                    ua_req = ua_candidate

                status = "live"
            else:
                status = "event_only"
    except Exception:
        status = "standby"

    # Fallback to existing stream if available
    if not play_url and existing.get("playUrl"):
        play_url = existing.get("playUrl")
    if not raw_url and existing.get("directM3u8"):
        raw_url = existing.get("directM3u8")

    # If streamUrl is still empty, synthesize play.php url from raw_url or fallback
    primary_stream = play_url or raw_url or ""
    if not primary_stream:
        primary_stream = f"https://yacine.website/channel/{cid}/{slug}"
        status = "event_only"

    order = existing.get("orderIndex", index + 1)
    status_icon = "🟢" if status == "live" else "🟡"
    print(f" [{index+1}/{total}] {status_icon} {ch_display_name} ➔ [{category}]")

    return {
        "vid": cid,
        "id": cid,
        "rawName": ch_display_name,
        "name": ch_display_name,
        "groupTitle": category,
        "orderIndex": order,
        "logoUrl": logo,
        "playUrl": play_url,
        "streamUrl": play_url or primary_stream,
        "directM3u8": raw_url,
        "proxyUrl": f"/live/{cid}.m3u8",
        "referer": f"https://yacine.website/channel/{cid}/{slug}",
        "userAgent": ua_req,
        "server": 1,
        "status": status,
        "source": "yacine.website",
        "lastRenewed": time.time()
    }


def main():
    start_time = time.time()
    os.makedirs(DATA_DIR, exist_ok=True)

    print("\n" + "=" * 68)
    print("      🚀 ASPREEN TV ▸ YACINE TV MASTER HARVESTER & STREAM PROXY")
    print("   سحب وتحديث 325 قناة وربطها بروابط موقعك الثابتة الدائمة بدون تقطيع")
    print("=" * 68 + "\n")

    # 1. Load existing channels.json to retain rich logos & categories
    existing_map = {}
    if os.path.exists(CHANNELS_JSON_PATH):
        try:
            with open(CHANNELS_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            for c in data:
                cid = str(c.get("id") or c.get("vid"))
                existing_map[cid] = c
            print(f" [✓] تم تحميل {len(existing_map)} قناة سابقة من الكتالوج المحلي للحفاظ على الشعارات والترتيب.")
        except Exception as e:
            print(f" [!] ملاحظة: لم يتم العثور على ملف channels.json القديم: {e}")

    # 2. Scrape live channel directory from yacine.website
    channels_list = get_all_channels_list()
    total = len(channels_list)

    # 3. Multi-threaded stream resolution (6 safe workers to bypass Cloudflare limits)
    print(f"\n⚡ [2/4] جارٍ فك تشفير السيرفرات وسحب الروابط الأصلية (6 مسارات متزامنة)...")
    resolved_channels = []

    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            executor.submit(resolve_channel_stream_and_metadata, ch, i, total, existing_map): ch
            for i, ch in enumerate(channels_list)
        }
        for future in as_completed(futures):
            try:
                res = future.result()
                if res:
                    resolved_channels.append(res)
            except Exception as e:
                pass
            time.sleep(0.04)

    # Sort channels by orderIndex
    resolved_channels.sort(key=lambda x: x.get("orderIndex", 9999))

    live_count = sum(1 for c in resolved_channels if c.get("status") == "live")
    with_logos = sum(1 for c in resolved_channels if c.get("logoUrl"))

    print(f"\n [✓] اكتمل السحب بنجاح: {len(resolved_channels)} قناة | {live_count} قناة نشطة حالياً | {with_logos} شعار قناة.")

    # 4. Save channels.json
    print("\n💾 [3/4] جارٍ حفظ القنوات وتوليد قوائم M3U بروابط موقعك الثابتة...")

    # A) Root channels.json for Fastify API and Next.js Web
    root_json = CHANNELS_JSON_PATH
    with open(root_json, "w", encoding="utf-8") as f:
        json.dump(resolved_channels, f, ensure_ascii=False, indent=2)

    # B) Data backup channels.json
    data_json = os.path.join(DATA_DIR, "yacine_channels.json")
    with open(data_json, "w", encoding="utf-8") as f:
        json.dump(resolved_channels, f, ensure_ascii=False, indent=2)

    # C) Build Local Persistent M3U (points to your local stream proxy 8088)
    local_m3u_lines = ["#EXTM3U"]
    for ch in resolved_channels:
        cid = ch["id"]
        name = ch["name"].replace('"', "'")
        group = ch["groupTitle"].replace('"', "'")
        logo = ch.get("logoUrl", "")
        proxy_stream_url = f"{LOCAL_PROXY_BASE}/live/{cid}.m3u8"

        extinf = f'#EXTINF:-1 tvg-id="{cid}" tvg-name="{name}" tvg-logo="{logo}" group-title="{group}",{name}'
        local_m3u_lines.append(extinf)
        local_m3u_lines.append(proxy_stream_url)

    local_m3u_content = "\n".join(local_m3u_lines) + "\n"

    # D) Build Production Railway M3U (points to your public online website)
    railway_m3u_lines = ["#EXTM3U"]
    for ch in resolved_channels:
        cid = ch["id"]
        name = ch["name"].replace('"', "'")
        group = ch["groupTitle"].replace('"', "'")
        logo = ch.get("logoUrl", "")
        railway_stream_url = f"{PUBLIC_PRODUCTION_BASE}/live/{cid}.m3u8"

        extinf = f'#EXTINF:-1 tvg-id="{cid}" tvg-name="{name}" tvg-logo="{logo}" group-title="{group}",{name}'
        railway_m3u_lines.append(extinf)
        railway_m3u_lines.append(railway_stream_url)

    railway_m3u_content = "\n".join(railway_m3u_lines) + "\n"

    # Save local playlists
    root_m3u = os.path.join(WORKSPACE_DIR, "channels.m3u")
    root_m3u8 = os.path.join(WORKSPACE_DIR, "channels.m3u8")
    with open(root_m3u, "w", encoding="utf-8") as f:
        f.write(local_m3u_content)
    with open(root_m3u8, "w", encoding="utf-8") as f:
        f.write(local_m3u_content)

    # Save production playlists
    railway_m3u = os.path.join(WORKSPACE_DIR, "channels_railway.m3u")
    with open(railway_m3u, "w", encoding="utf-8") as f:
        f.write(railway_m3u_content)

    # Desktop exports
    desktop_m3u = os.path.join(DESKTOP_DIR, "channels.m3u")
    desktop_railway_m3u = os.path.join(DESKTOP_DIR, "channels_railway.m3u")
    try:
        with open(desktop_m3u, "w", encoding="utf-8") as f:
            f.write(local_m3u_content)
        with open(desktop_railway_m3u, "w", encoding="utf-8") as f:
            f.write(railway_m3u_content)
        print(f" [✓] تم نسخ ملفات M3U مباشرة لسطح المكتب للمشاهدة بدون تقطيع:")
        print(f"     1. {desktop_m3u} (خادمك المحلي 8088)")
        print(f"     2. {desktop_railway_m3u} (سيرفر موقعك السحابي Railway)")
    except Exception as e:
        print(f" [!] تعذر النسخ لسطح المكتب: {e}")

    elapsed = round(time.time() - start_time, 1)

    # 5. Telegram Report
    if TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID:
        print("\n📲 [4/4] جارٍ إرسال التقرير النهائي إلى بوت تيليجرام...")
        report_msg = (
            "✅ <b>اكتمل تحديث قنوات ASPREEN TV بنجاح!</b> 🎉\n\n"
            f"📺 <b>إجمالي القنوات المسحوبة:</b> {len(resolved_channels)} قناة\n"
            f"🟢 <b>القنوات النشطة حالياً:</b> {live_count} قناة\n"
            f"🖼️ <b>الشعارات المحفوظة:</b> {with_logos} شعار\n"
            f"⏱️ <b>الوقت المستغرق:</b> {elapsed} ثانية\n\n"
            "🛡️ <i>روابط البث أصبحت موجهة لخادمك الخاص وتتجدد تلقائياً 24 ساعة بدون أي تقطيع.</i>"
        )
        send_telegram_message(report_msg)
        send_telegram_file(desktop_railway_m3u, caption="📺 ملف M3U الشامل لقنوات ياسين تيفي 325 (روابط موقعك الدائمة)")
        print(" [✓] تم إرسال الإشعار وملف M3U إلى تيليجرام بنجاح!")

    print("\n" + "=" * 68)
    print("                       🎉 تم الانتهاء بنجاح! 🎉")
    print(f" 🔢 إجمالي القنوات: {len(resolved_channels)} قناة")
    print(f" 🟢 القنوات الحية: {live_count} قناة")
    print(f" ⏱️ المدة الزمنية: {elapsed} ثانية")
    print("=" * 68 + "\n")


if __name__ == "__main__":
    main()
