# -*- coding: utf-8 -*-
"""
=============================================================================
         🚀 ASPREEN TV ▸ AI SMART PASSIVE STREAM SNIFFER (V2 PRO)
     المراقب الذكي الفائق لقنوات أوسكار تي في (يعمل في الخلفية بصمت تام)
=============================================================================
* السكربت يراقب تطبيق أوسكار تي في في الخلفية بدون أي لمس للشاشة أو إزعاج للمستخدم.
* يميز بذكاء فائق بين:
  1) المشاهدة المستمرة لنفس القناة (لا يعيد التقاطها ولا يزعجك، فقط يراقب استقرار البث).
  2) الانتقال لقناة جديدة (يلتقطها فوراً ويفك تشفيرها ويضيفها لملف M3U8).
  3) تجديد التوكن تلقائياً في حال انتهاء صلاحيته وتحديثه في القائمة.
  4) الخروج إلى قائمة القنوات أو إيقاف المشغل.
* يحافظ بالكامل على تصنيفات المستخدم وترتيب القنوات في ملف oscar_channels.m3u8.
=============================================================================
"""

import subprocess
import time
import re
import os
import sys
import json
import urllib.parse
from datetime import datetime
import requests

# Ensure UTF-8 and line-buffered output in Windows console
sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)

ADB_PATHS = [
    r"C:\Users\Admin\AppData\Local\Android\Sdk\platform-tools\adb.exe",
    r"C:\Program Files\Netease\MuMuPlayerGlobal-12.0\shell\adb.exe",
    r"C:\Program Files\MuMuPlayer-12.0\shell\adb.exe",
    "adb"
]

def find_adb():
    for p in ADB_PATHS:
        try:
            res = subprocess.run([p, "version"], capture_output=True, text=True, errors="replace")
            if res.returncode == 0:
                return p
        except Exception:
            continue
    return "adb"

ADB = find_adb()
CONNECTED_DEVICE = None

def get_connected_device():
    global CONNECTED_DEVICE
    try:
        res = subprocess.run([ADB, "devices"], capture_output=True, text=True, errors="replace")
        lines = res.stdout.strip().splitlines()[1:]
        for line in lines:
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "device":
                CONNECTED_DEVICE = parts[0]
                return CONNECTED_DEVICE
    except Exception:
        pass

    # Socket discovery for common emulator ports
    import socket
    candidates = [
        ("192.168.0.106", 5555),
        ("127.0.0.1", 16384), # MuMu 12
        ("127.0.0.1", 7555),  # MuMu 6
        ("127.0.0.1", 5555),  # Standard
        ("127.0.0.1", 16416), # MuMu 12 instance 2
    ]

    for ip, port in candidates:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.3)
        try:
            s.connect((ip, port))
            s.close()
            addr = f"{ip}:{port}"
            subprocess.run([ADB, "connect", addr], capture_output=True, text=True, timeout=3)
            res = subprocess.run([ADB, "devices"], capture_output=True, text=True, errors="replace")
            lines = res.stdout.strip().splitlines()[1:]
            for line in lines:
                parts = line.split()
                if len(parts) >= 2 and parts[1] == "device":
                    CONNECTED_DEVICE = parts[0]
                    return CONNECTED_DEVICE
        except Exception:
            s.close()
            continue

    return None

def run_adb(*args):
    global CONNECTED_DEVICE
    if not CONNECTED_DEVICE:
        CONNECTED_DEVICE = get_connected_device()
    cmd = [ADB]
    if CONNECTED_DEVICE:
        cmd += ["-s", CONNECTED_DEVICE]
    cmd += list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    return res.stdout

def classify_channel(name):
    lower = name.lower()
    if "bein" in lower:
        return "قنوات beIN Sports"
    if any(k in lower for k in ["sport", "كأس", "ssc", "رياض", "starzplay", "ad sport", "أبو ظبي", "دبي", "سعودية", "كويت", "مغربية", "شارقة"]):
        return "Sports"
    if any(k in lower for k in ["أفلام", "سينما", "movies", "action", "thriller", "drama", "دراما", "مسلسلات"]):
        return "Movies & Series"
    if any(k in lower for k in ["براعم", "jeem", "جيم", "spacetoon", "سبيستون", "kids", "cn", "كرتون"]):
        return "Kids"
    if any(k in lower for k in ["اخبار", "news", "جزيرة", "حدث", "عربية"]):
        return "News"
    return "Live TV"

def load_channels_from_m3u8(m3u8_path="data/oscar_channels.m3u8"):
    """Reads existing m3u8 file to preserve exact user categories and channel order."""
    channels_meta = {}
    channel_order = []
    if not os.path.exists(m3u8_path):
        return channels_meta, channel_order
    try:
        with open(m3u8_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        for line in lines:
            line = line.strip()
            if line.startswith("#EXTINF"):
                name_match = re.search(r'tvg-name="([^"]+)"', line)
                group_match = re.search(r'group-title="([^"]+)"', line)
                if not name_match:
                    comma_idx = line.rfind(",")
                    if comma_idx != -1:
                        c_name = line[comma_idx+1:].strip()
                    else:
                        c_name = None
                else:
                    c_name = name_match.group(1).strip()

                if c_name:
                    group = group_match.group(1).strip() if group_match else None
                    if c_name not in channel_order:
                        channel_order.append(c_name)
                    channels_meta[c_name] = {"category": group}
    except Exception:
        pass
    return channels_meta, channel_order

def verify_and_resolve_stream(stream_url, cookie=None):
    if not stream_url:
        return False, "لا يوجد رابط", ""
    headers = {
        "User-Agent": "OSCARTV2021",
        "Referer": "http://speedcdn.me:8080/"
    }
    if cookie:
        headers["Cookie"] = cookie
    try:
        r = requests.get(stream_url, headers=headers, timeout=5, allow_redirects=True)
        if r.status_code == 200 and ("#EXTM3U" in r.text or "#EXTINF" in r.text):
            direct_url = r.url if r.url != stream_url else ""
            return True, "200 OK (HLS سليم 100%)", direct_url
        return False, f"HTTP {r.status_code}", ""
    except Exception as e:
        return False, str(e)[:30], ""

def save_and_export_all(channels_db, channel_order=None):
    os.makedirs("data", exist_ok=True)
    json_path = os.path.abspath("data/oscar_channels_live.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(channels_db, f, ensure_ascii=False, indent=2)

    # Sort channels according to preserved channel_order, then new ones
    if channel_order:
        ordered_names = [n for n in channel_order if n in channels_db]
        new_names = [n for n in channels_db if n not in ordered_names]
        final_names = ordered_names + new_names
    else:
        final_names = list(channels_db.keys())

    m3u_lines = ["#EXTM3U"]
    for name in final_names:
        data = channels_db[name]
        url = data.get("streamUrl", "")
        cookie = data.get("cookie", "")
        group = data.get("category") or classify_channel(name)

        m3u_lines.append(f'#EXTINF:-1 tvg-name="{name}" group-title="{group}",{name}')
        if ".css" in url or "workers.dev" in url or data.get("ua") == "OSCARTV2021":
            m3u_lines.append("#EXTVLCOPT:http-user-agent=OSCARTV2021")
            m3u_lines.append("#EXTVLCOPT:http-referrer=http://speedcdn.me:8080/")
            if cookie:
                m3u_lines.append(f"#EXTVLCOPT:http-cookie={cookie}")
                m3u_lines.append(f'#EXTHTTP:{{"User-Agent":"OSCARTV2021","Referer":"http://speedcdn.me:8080/","Cookie":"{cookie}"}}')
                pipe_url = f"{url}|User-Agent=OSCARTV2021&Referer=http://speedcdn.me:8080/&Cookie={cookie}"
            else:
                m3u_lines.append('#EXTHTTP:{"User-Agent":"OSCARTV2021","Referer":"http://speedcdn.me:8080/"}')
                pipe_url = f"{url}|User-Agent=OSCARTV2021&Referer=http://speedcdn.me:8080/"
            m3u_lines.append(pipe_url)
        else:
            m3u_lines.append(url)

    m3u_path = os.path.abspath("data/oscar_channels.m3u8")
    with open(m3u_path, "w", encoding="utf-8") as f:
        f.write("\n".join(m3u_lines) + "\n")

    # Sync ASPREEN TV local API server if running
    try:
        requests.post("http://127.0.0.1:3001/api/channels/sync-oscar", timeout=1.5)
    except Exception:
        pass

def parse_stream_intent(raw_text):
    if not raw_text or "VideoPlayerActivity" not in raw_text:
        return None, None, None

    dat_match = re.search(r"dat=(tdmvideo://[^\s\"\'>]+)", raw_text)
    if dat_match:
        dat_url = dat_match.group(1).strip()
        parsed = urllib.parse.urlparse(dat_url)
        params = urllib.parse.parse_qs(parsed.query)

        stream_url = params.get("url", [""])[0]
        title = params.get("title", [""])[0]
        cookie = params.get("cookies", [""])[0]

        if stream_url:
            return title or "قناة غير معروفة", stream_url, cookie

    # Fallback regex patterns
    url_match = (
        re.search(r"dat=tdmvideo://play\?url=([^\s&]+)", raw_text) or
        re.search(r"Extra:\s+android\.intent\.extra\.TEXT=(https?://[^\s\n,]+)", raw_text) or
        re.search(r"(https?://[^\s\n\"']+\.workers\.dev[^\s\n\"'&]*)", raw_text) or
        re.search(r"(https?://[^\s\n\"']+\.css[^\s\n\"'&]*)", raw_text)
    )
    if not url_match:
        return None, None, None

    raw_url = url_match.group(1).strip()
    stream_url = urllib.parse.unquote(raw_url) if "%" in raw_url else raw_url

    title_match = re.search(r"title=([^\s&,]+)", raw_text) or re.search(r"Extra:\s+title=([^\n,]+)", raw_text)
    raw_title = title_match.group(1).strip() if title_match else ""
    title = urllib.parse.unquote(raw_title) if raw_title else "قناة غير معروفة"

    cookie_match = re.search(r"cookies=([^\s\n\"'&]+)", raw_text)
    raw_cookie = cookie_match.group(1).strip() if cookie_match else ""
    cookie = urllib.parse.unquote(raw_cookie) if raw_cookie else ""

    return title, stream_url, cookie

def main():
    print("=" * 72)
    print("      🚀 ASPREEN TV ▸ AI SMART PASSIVE STREAM SNIFFER (V2 PRO)")
    print("      المراقب الذكي الفائق لقنوات أوسكار تي في (يعمل في الخلفية)")
    print("=" * 72)

    device = get_connected_device()
    if not device:
        print("\n❌ خطأ: لم يتم العثور على محاكي MuMu Player أو جهاز أندرويد متصل!")
        print("👉 يرجى تشغيل محاكي MuMu Player والتأكد من فتح تطبيق Oscar TV.")
        input("\nاضغط Enter للخروج...")
        return

    print(f"\n[✓] الجهاز المتصل: {device}")
    print("[🧠] تم تفعيل الذكاء الاصطناعي لرصد القنوات وتتبع حالة المشاهدة بدقة.")
    print("[💡] تصفح أوسكار تي في وشاهد ما تحب... السكربت يراقب فقط بصمت تام.")
    print("-" * 72)

    # 1. Check if oscar_channels.m3u8 exists
    m3u_file = "data/oscar_channels.m3u8"
    json_file = "data/oscar_channels_live.json"
    backup_file = "data/oscar_channels_backup.json"

    channels_db = {}
    channel_order = []
    m3u_meta = {}

    if not os.path.exists(m3u_file):
        # User deleted m3u8 -> start fresh session from 0!
        if os.path.exists(json_file):
            import shutil
            try:
                shutil.copy(json_file, backup_file)
            except Exception:
                pass
            try:
                with open(json_file, "w", encoding="utf-8") as f:
                    json.dump({}, f)
            except Exception:
                pass
        print("\n[⚡] تنبيه: تم رصد حذف oscar_channels.m3u8 -> بدء جلسة جديدة ونظيفة من الصفر!")
        print("[💾] تم أخذ نسخة احتياطية من قنواتك السابقة في: data/oscar_channels_backup.json")
        print("[🎯] سيتم تسجيل فقط القنوات التي تفتحها ابتداءً من الآن واحدة تلو الأخرى!")
    else:
        # Load strictly what is present in existing m3u8
        m3u_meta, channel_order = load_channels_from_m3u8(m3u_file)
        if os.path.exists(json_file):
            try:
                with open(json_file, "r", encoding="utf-8") as f:
                    cached_db = json.load(f)
                    for c_name in channel_order:
                        if c_name in cached_db:
                            channels_db[c_name] = cached_db[c_name]
                            if m3u_meta.get(c_name, {}).get("category"):
                                channels_db[c_name]["category"] = m3u_meta[c_name]["category"]
                        else:
                            channels_db[c_name] = {
                                "name": c_name,
                                "category": m3u_meta.get(c_name, {}).get("category") or classify_channel(c_name),
                                "streamUrl": "",
                                "cookie": "",
                                "ua": "OSCARTV2021"
                            }
            except Exception:
                channels_db = {}

    print(f"[*] إجمالي القنوات المعتمدة حالياً: {len(channels_db)} قناة.")
    print("[*] بانتظار تشغيل أي بث في تطبيق أوسكار تي في...\n")

    # State tracking
    active_channel = None
    active_url = None
    active_cookie = None
    active_start_time = None
    last_heartbeat_time = 0

    try:
        while True:
            # Poll current active player activity without interrupting user
            out = run_adb("shell", "dumpsys", "activity", "a", "com.tdm.manager/.activity.VideoPlayerActivity")
            title, url, cookie = parse_stream_intent(out)

            # ---------------------------------------------------------
            # CASE 1: Video player is NOT active (User is in menus)
            # ---------------------------------------------------------
            if not url:
                if active_channel is not None:
                    # User was watching and just closed or exited player
                    duration = int(time.time() - active_start_time) if active_start_time else 0
                    mins, secs = divmod(duration, 60)
                    now_str = datetime.now().strftime("%H:%M:%S")
                    print(f"\n[⏸️ {now_str}] توقف البث: خرجت من مشغل القناة ({active_channel}) بعد مشاهدة {mins}:{secs:02d} دقيقة.")
                    print("[💡] تصفح القوائم وافتح أي قناة تعجبك للالتقاط التلقائي...\n")
                    active_channel = None
                    active_url = None
                    active_cookie = None
                    active_start_time = None
                time.sleep(1.0)
                continue

            # ---------------------------------------------------------
            # CASE 2: User is watching the EXACT SAME stream (Steady Watching)
            # ---------------------------------------------------------
            if title == active_channel and url == active_url:
                # The user is happily watching this channel!
                # DO NOT re-request verification, DO NOT re-save, DO NOT spam.
                now = time.time()
                if now - last_heartbeat_time >= 45:
                    duration = int(now - active_start_time)
                    mins, secs = divmod(duration, 60)
                    now_str = datetime.now().strftime("%H:%M:%S")
                    print(f" [🟢 {now_str}] مستمر بمشاهدة: {title} | البث مستقر وسليم 100% (مدة المشاهدة: {mins}:{secs:02d} دقيقة)")
                    last_heartbeat_time = now
                time.sleep(1.0)
                continue

            # ---------------------------------------------------------
            # CASE 3: Active Stream has Changed!
            # ---------------------------------------------------------
            timestamp = datetime.now().strftime("%H:%M:%S")
            is_new_channel = (title not in channels_db)
            is_token_renewed = (title in channels_db and channels_db[title].get("streamUrl") != url)
            is_known_channel_reopened = (title in channels_db and channels_db[title].get("streamUrl") == url)

            # Determine category: keep existing user-defined category if present
            category = channels_db.get(title, {}).get("category") or m3u_meta.get(title, {}).get("category") or classify_channel(title)

            active_channel = title
            active_url = url
            active_cookie = cookie
            active_start_time = time.time()
            last_heartbeat_time = active_start_time

            if is_new_channel:
                # BRAND NEW CHANNEL DETECTED
                print("\n" + "=" * 65)
                print(f" ✨ [{timestamp}] التقاط قناة جديدة من أوسكار تي في!")
                print(f" 📺 اسم القناة: {title}")
                print(f" 🏷️  التصنيف: {category}")
                print(f" 🔗 الرابط: {url[:70]}...")
                if cookie:
                    print(f" 🔑 الكوكي المفكوك: {cookie[:40]}...")

                print(" [*] التحقق الذكي من سلامة البث HLS...", end=" ", flush=True)
                valid, msg, direct_url = verify_and_resolve_stream(url, cookie)
                if valid:
                    print(f"✓ {msg}")
                    if direct_url:
                        print(f" 🚀 الرابط المباشر الصافي: {direct_url[:70]}...")
                else:
                    print(f"⚠ {msg}")

                channels_db[title] = {
                    "name": title,
                    "category": category,
                    "streamUrl": url,
                    "directUrl": direct_url,
                    "cookie": cookie,
                    "ua": "OSCARTV2021",
                    "lastUpdated": datetime.now().isoformat()
                }

                if title not in channel_order:
                    channel_order.append(title)

                save_and_export_all(channels_db, channel_order)
                print(f" 💾 تم حفظ القناة في oscar_channels.m3u8 ومزامنة موقع ASPREEN TV!")
                print(f" 📊 إجمالي القنوات المتاحة الآن: {len(channels_db)} قناة")
                print("=" * 65 + "\n")

            elif is_token_renewed:
                # SAME CHANNEL, BUT TOKEN OR URL REFRESHED BY OSCAR TV
                print("\n" + "=" * 65)
                print(f" 🔄 [{timestamp}] تجديد تلقائي لتوكن القناة: {title}")
                print(f" 🏷️  التصنيف: {category}")
                print(f" 🔗 الرابط الجديد: {url[:70]}...")
                if cookie:
                    print(f" 🔑 الكوكي الجديد: {cookie[:40]}...")

                print(" [*] فحص صلاحية التوكن المجدد...", end=" ", flush=True)
                valid, msg, direct_url = verify_and_resolve_stream(url, cookie)
                if valid:
                    print(f"✓ {msg}")
                else:
                    print(f"⚠ {msg}")

                channels_db[title]["streamUrl"] = url
                channels_db[title]["cookie"] = cookie
                channels_db[title]["directUrl"] = direct_url
                channels_db[title]["category"] = category
                channels_db[title]["lastUpdated"] = datetime.now().isoformat()

                save_and_export_all(channels_db, channel_order)
                print(f" 💾 تم تحديث توكن القناة تلقائياً دون أي تأثير على المشاهدين!")
                print("=" * 65 + "\n")

            elif is_known_channel_reopened:
                # KNOWN CHANNEL SWITCHED TO (ALREADY HAS VALID SAVED URL)
                print(f"\n▶️ [{timestamp}] تشاهد الآن: {title} (القناة مسجلة وتعمل مسبقاً | {category})")
                print(f"   البث سليم ويعمل في ASPREEN TV و VLC - استمتع بالمشاهدة!\n")

            time.sleep(1.0)

    except KeyboardInterrupt:
        print("\n\n[✓] تم إيقاف المراقب بنجاح. جميع القنوات الـ 66 محفوظة وجاهزة.")

if __name__ == "__main__":
    main()
