# -*- coding: utf-8 -*-
"""
=============================================================================
         ASPREEN TV ▸ YACINE TV MASTER HARVESTER & STREAM PROXY
    سكربت سحب وتحديث جميع قنوات ياسين تيفي (325 قناة) من الألف إلى الياء
    مع استخراج الشعارات وروابط M3U/M3U8 وتخطي الحجب وبوت تيليجرام للحالة
=============================================================================
"""

import os
import sys
import re
import json
import time
import base64
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DESKTOP_DIR = os.path.join(os.path.expanduser("~"), "Desktop")
DATA_DIR = os.path.join(WORKSPACE_DIR, "data")
CONFIG_FILE = os.path.join(WORKSPACE_DIR, "telegram_config.json")

# Default Telegram settings (reads from ENV or config file)
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_ADMIN_CHAT_ID = os.getenv("TELEGRAM_ADMIN_CHAT_ID", "")

# Load from telegram_config.json if available
if os.path.exists(CONFIG_FILE):
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            TELEGRAM_BOT_TOKEN = cfg.get("bot_token", TELEGRAM_BOT_TOKEN)
            TELEGRAM_ADMIN_CHAT_ID = cfg.get("admin_chat_id", TELEGRAM_ADMIN_CHAT_ID)
    except Exception:
        pass

# Also check root .env if exists
ENV_PATH = os.path.join(WORKSPACE_DIR, ".env")
if os.path.exists(ENV_PATH):
    try:
        with open(ENV_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("TELEGRAM_BOT_TOKEN=") and not TELEGRAM_BOT_TOKEN:
                    TELEGRAM_BOT_TOKEN = line.split("=", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("TELEGRAM_ADMIN_CHAT_ID=") and not TELEGRAM_ADMIN_CHAT_ID:
                    TELEGRAM_ADMIN_CHAT_ID = line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass

# Geo-Bypass Headers
BYPASS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://yacine.website/",
    "X-Forwarded-For": "156.200.1.1",  # Egypt/Algeria IP bypass
    "CF-Connecting-IP": "156.200.1.1",
    "X-Real-IP": "156.200.1.1",
    "Accept": "application/json, text/html, */*"
}


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
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.getcode() == 200
    except Exception as e:
        print(f" [!] خطأ في إرسال إشعار تيليجرام: {e}")
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
        # chat_id
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{TELEGRAM_ADMIN_CHAT_ID}\r\n".encode())
        # caption
        if caption:
            body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\n{caption}\r\n".encode())
        # document
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{filename}\"\r\nContent-Type: audio/x-mpegurl\r\n\r\n".encode())
        body.extend(file_data)
        body.extend(f"\r\n--{boundary}--\r\n".encode())

        req = urllib.request.Request(url, data=bytes(body), headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}"
        })
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.getcode() == 200
    except Exception as e:
        print(f" [!] خطأ في إرسال ملف M3U إلى تيليجرام: {e}")
        return False


def get_all_channels_list():
    """Scrapes homepage and /channels to find all 325 channels with IDs and Slugs"""
    print("📡 [1/4] جارٍ الاتصال بموقع yacine.website واكتشاف جميع القنوات...")
    url = "https://yacine.website/"
    req = urllib.request.Request(url, headers=BYPASS_HEADERS)
    with urllib.request.urlopen(req, timeout=12) as resp:
        html = resp.read().decode("utf-8", errors="ignore")

    matches = re.findall(r'href=["\']/channel/(\d+)/([^"\']+)["\']', html)
    unique_channels = {}
    for cid, slug in matches:
        if cid not in unique_channels:
            clean_name = slug.replace("-", " ")
            unique_channels[cid] = {
                "id": cid,
                "slug": slug,
                "name": clean_name
            }

    channels_list = list(unique_channels.values())
    print(f" [✓] تم اكتشاف {len(channels_list)} قناة فريدة بنجاح من الألف إلى الياء!")
    return channels_list


def resolve_channel_details_and_stream(ch, index, total):
    """Extracts logo, category, and direct M3U8 stream URL for a single channel"""
    cid = ch["id"]
    slug = ch["slug"]
    page_url = f"https://yacine.website/channel/{cid}/{slug}"
    api_url = f"https://yacine.website/index.php?get_channel_stream={cid}"

    logo = ""
    category = "قنوات عامة"
    stream_url = ""
    direct_m3u8 = ""
    ua_req = ""
    status = "standby"

    # 1. Fetch channel page for Logo and Category
    try:
        req = urllib.request.Request(page_url, headers=BYPASS_HEADERS)
        with urllib.request.urlopen(req, timeout=8) as r:
            html = r.read().decode("utf-8", errors="ignore")

            logo_m = re.search(r'class=["\']title-logo["\']\s+src=["\']([^"\']+)["\']', html)
            if logo_m:
                logo = logo_m.group(1).strip()

            cat_m = re.search(r'<th>التصنيف</th>\s*<td>(.*?)</td>', html)
            if cat_m:
                category = cat_m.group(1).strip()
            else:
                # Guess from name
                name_upper = ch["name"].upper()
                if "BEIN" in name_upper or "SPORT" in name_upper or "KASS" in name_upper or "SSC" in name_upper:
                    category = "قنوات رياضية (Sports)"
                elif "MBC" in name_upper:
                    category = "باقة MBC CHANNELS"
                elif "OSN" in name_upper:
                    category = "باقة OSN Network"
    except Exception:
        pass

    # 2. Call Stream API with Geo-Bypass
    try:
        req = urllib.request.Request(api_url, headers=BYPASS_HEADERS)
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode("utf-8", errors="ignore"))
            if data.get("status") == "success":
                raw_url = data.get("raw_url", "").strip()
                play_url = data.get("url", "").strip()
                ua_req = data.get("user_agent", "")

                if raw_url:
                    stream_url = raw_url
                    direct_m3u8 = raw_url
                    status = "live"
                elif "url=" in play_url:
                    try:
                        encoded = play_url.split("url=")[1].split("&")[0]
                        decoded = base64.b64decode(encoded).decode("utf-8", errors="ignore")
                        stream_url = decoded
                        direct_m3u8 = decoded
                        status = "live"
                    except Exception:
                        stream_url = f"https://yacine.website{play_url}"
                else:
                    stream_url = f"https://yacine.website{play_url}" if play_url else ""
    except Exception:
        pass

    # Fallback to embed player if no stream is active right now
    if not stream_url:
        stream_url = page_url
        status = "web_embed"

    status_icon = "🟢" if status == "live" else "🟡"
    print(f" [{index+1}/{total}] {status_icon} {ch['name']} ➔ [{category}]")

    return {
        "vid": cid,
        "id": cid,
        "rawName": ch["name"],
        "name": ch["name"],
        "groupTitle": category,
        "orderIndex": index + 1,
        "logoUrl": logo,
        "streamUrl": stream_url,
        "directM3u8": direct_m3u8,
        "referer": "https://yacine.website/",
        "userAgent": ua_req or BYPASS_HEADERS["User-Agent"],
        "server": 1,
        "status": status,
        "source": "yacine.website"
    }


def main():
    start_time = time.time()
    os.makedirs(DATA_DIR, exist_ok=True)

    print("\n" + "=" * 65)
    print("      ASPREEN TV ▸ YACINE TV MASTER HARVESTER & STREAM PROXY")
    print("         سحب وتحديث 325 قناة مع الشعارات والروابط وبوت تيليجرام")
    print("=" * 65 + "\n")

    # Notify Telegram Start
    if TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID:
        print(" [✓] تم تفعيل نظام إشعارات بوت تيليجرام.")
        start_msg = (
            "🚀 <b>بدء عملية سحب وتحديث القنوات:</b>\n\n"
            "🌐 <b>المصدر:</b> yacine.website (325 قناة)\n"
            "⚙️ <b>العملية:</b> تخطي الحجب الجغرافي واستخراج M3U8 والشعارات\n"
            f"⏱️ <b>التوقيت:</b> {time.strftime('%Y-%m-%d %H:%M:%S')}"
        )
        send_telegram_message(start_msg)
    else:
        print(" [i] بوت تيليجرام غير مضبوط (يمكنك كتابة التوكن في telegram_config.json).")

    # 1. Fetch channel directory
    channels_list = get_all_channels_list()
    total = len(channels_list)

    # 2. Multi-threaded Resolution (12 workers for lightning speed)
    print(f"\n⚡ [2/4] جارٍ فك تشفير وتخطي الحجب وسحب الروابط والشعارات (12 مسار متزامن)...")
    resolved_channels = []

    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = {
            executor.submit(resolve_channel_details_and_stream, ch, i, total): ch
            for i, ch in enumerate(channels_list)
        }
        for future in as_completed(futures):
            try:
                res = future.result()
                if res:
                    resolved_channels.append(res)
            except Exception as e:
                pass

    # Sort channels by orderIndex
    resolved_channels.sort(key=lambda x: x["orderIndex"])

    live_count = sum(1 for c in resolved_channels if c["status"] == "live")
    with_logos = sum(1 for c in resolved_channels if c["logoUrl"])

    print(f"\n [✓] اكتمل السحب: {len(resolved_channels)} قناة | {live_count} رابط بث مباشر نشط | {with_logos} شعار قناة.")

    # 3. Export to JSON & M3U files
    print("\n💾 [3/4] جارٍ حفظ القنوات في ملفات النظام وتحديث الموقع...")

    # Root channels.json for ASPREEN TV
    root_json = os.path.join(WORKSPACE_DIR, "channels.json")
    with open(root_json, "w", encoding="utf-8") as f:
        json.dump(resolved_channels, f, ensure_ascii=False, indent=2)

    # Data backup JSON
    data_json = os.path.join(DATA_DIR, "yacine_channels.json")
    with open(data_json, "w", encoding="utf-8") as f:
        json.dump(resolved_channels, f, ensure_ascii=False, indent=2)

    # M3U / M3U8 Playlists
    m3u_lines = ["#EXTM3U"]
    for ch in resolved_channels:
        name = ch["name"].replace('"', "'")
        group = ch["groupTitle"].replace('"', "'")
        logo = ch["logoUrl"]
        stream = ch["streamUrl"]
        ref = ch.get("referer", "https://yacine.website/")

        extinf = f'#EXTINF:-1 tvg-id="{ch["id"]}" tvg-name="{name}" tvg-logo="{logo}" group-title="{group}" http-referrer="{ref}",{name}'
        m3u_lines.append(extinf)
        m3u_lines.append(f"#EXTVLCOPT:http-referrer={ref}")
        m3u_lines.append(f"#EXTVLCOPT:http-user-agent={ch.get('userAgent', BYPASS_HEADERS['User-Agent'])}")
        m3u_lines.append(stream)

    m3u_content = "\n".join(m3u_lines) + "\n"

    # Root M3U & M3U8
    root_m3u = os.path.join(WORKSPACE_DIR, "channels.m3u")
    root_m3u8 = os.path.join(WORKSPACE_DIR, "channels.m3u8")
    with open(root_m3u, "w", encoding="utf-8") as f:
        f.write(m3u_content)
    with open(root_m3u8, "w", encoding="utf-8") as f:
        f.write(m3u_content)

    # Desktop copies
    desktop_m3u = os.path.join(DESKTOP_DIR, "channels.m3u")
    desktop_yacine_m3u = os.path.join(DESKTOP_DIR, "yacine_channels_325.m3u")
    try:
        with open(desktop_m3u, "w", encoding="utf-8") as f:
            f.write(m3u_content)
        with open(desktop_yacine_m3u, "w", encoding="utf-8") as f:
            f.write(m3u_content)
        print(f" [✓] تم نسخ ملفات M3U مباشرة لسطح المكتب: {desktop_m3u}")
    except Exception as e:
        print(f" [!] تعذر النسخ لسطح المكتب: {e}")

    elapsed = round(time.time() - start_time, 1)

    # 4. Telegram Completion Report & File Sending
    if TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID:
        print("\n📲 [4/4] جارٍ إرسال التقرير النهائي وملف M3U إلى بوت تيليجرام...")
        categories_set = set(c["groupTitle"] for c in resolved_channels)
        report_msg = (
            "✅ <b>اكتمل تحديث قنوات ASPREEN TV بنجاح!</b> 🎉\n\n"
            f"📺 <b>إجمالي القنوات المسحوبة:</b> {len(resolved_channels)} قناة\n"
            f"🟢 <b>روابط البث المباشر:</b> {live_count} قناة\n"
            f"🖼️ <b>الشعارات المحملة:</b> {with_logos} شعار\n"
            f"📁 <b>التصنيفات المكتشفة:</b> {len(categories_set)} تصنيف\n"
            f"⏱️ <b>الوقت المستغرق:</b> {elapsed} ثانية\n\n"
            "🌐 <i>تم تحديث قاعدة بيانات موقعك وملفات channels.json و channels.m3u تلقائياً.</i>"
        )
        send_telegram_message(report_msg)
        send_telegram_file(root_m3u, caption="📺 ملف M3U الشامل لجميع قنوات ياسين تيفي 325")
        print(" [✓] تم إرسال الإشعار وملف M3U إلى تيليجرام بنجاح!")

    print("\n" + "=" * 65)
    print("                       🎉 تم الانتهاء بنجاح! 🎉")
    print(f" 🔢 إجمالي القنوات: {len(resolved_channels)} من الألف للياء")
    print(f" 🟢 قنوات البث المباشر M3U8: {live_count}")
    print(f" 🖼️ شعارات القنوات: {with_logos}")
    print(f" ⏱️ المدة الزمنية: {elapsed} ثانية")
    print(f" 📁 الملفات الناتجة:")
    print(f"    1. {root_json}")
    print(f"    2. {root_m3u}")
    print(f"    3. {desktop_m3u}")
    print("=" * 65 + "\n")


if __name__ == "__main__":
    main()
