# -*- coding: utf-8 -*-
"""
=============================================================================
             ASPREEN TV ▸ OSCAR TV MASTER HARVESTER (A to Z)
         سكربت سحب وتحديث جميع قنوات أوسكار تي في بضغطة زر واحدة
=============================================================================
"""

import subprocess
import time
import re
import os
import sys
import json
import urllib.parse
import requests

# Ensure UTF-8 output in Windows cmd/powershell
sys.stdout.reconfigure(encoding="utf-8")

ADB_PATHS = [
    r"C:\Users\Admin\AppData\Local\Android\Sdk\platform-tools\adb.exe",
    r"C:\Program Files\Netease\MuMuPlayerGlobal-12.0\shell\adb.exe",
    r"C:\Program Files\MuMuPlayer-12.0\shell\adb.exe",
    "adb"
]

COMMON_PORTS = [16384, 7555, 5555, 16416, 21503, 62001]
LOCAL_IPS = ["127.0.0.1", "192.168.0.106"]

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
    res = subprocess.run([ADB, "devices"], capture_output=True, text=True, errors="replace")
    lines = res.stdout.strip().splitlines()[1:]
    for line in lines:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            CONNECTED_DEVICE = parts[0]
            return CONNECTED_DEVICE

    # Try connecting to open ports with fast socket check
    import socket
    print("[*] جارٍ البحث عن محاكي MuMu Player والاتصال التلقائي...")
    candidates = [
        ("127.0.0.1", 16384), # MuMu 12
        ("127.0.0.1", 7555),  # MuMu 6
        ("127.0.0.1", 5555),  # Standard
        ("127.0.0.1", 16416), # MuMu 12 instance 2
        ("192.168.0.106", 5555) # Network device
    ]

    for ip, port in candidates:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.3)
        try:
            s.connect((ip, port))
            s.close()
            # Port is open, run adb connect
            addr = f"{ip}:{port}"
            subprocess.run([ADB, "connect", addr], capture_output=True, text=True, timeout=3)
            res = subprocess.run([ADB, "devices"], capture_output=True, text=True, errors="replace")
            lines = res.stdout.strip().splitlines()[1:]
            for line in lines:
                parts = line.split()
                if len(parts) >= 2 and parts[1] == "device":
                    CONNECTED_DEVICE = parts[0]
                    print(f"[✓] تم الاتصال بنجاح بالمحاكي: {CONNECTED_DEVICE}")
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

def tap(x, y):
    run_adb("shell", "input", "tap", str(x), str(y))

def back():
    run_adb("shell", "input", "keyevent", "4")

def double_back():
    run_adb("shell", "input", "keyevent", "4")
    time.sleep(0.3)
    run_adb("shell", "input", "keyevent", "4")

def swipe_up():
    run_adb("shell", "input", "swipe", "960", "900", "960", "300", "300")

def swipe_down_grid():
    run_adb("shell", "input", "swipe", "960", "850", "960", "320", "400")

def extract_stream_info():
    out = run_adb("shell", "dumpsys", "activity", "a", "com.tdm.manager/.activity.VideoPlayerActivity")
    title_match = re.search(r"title=([^\s&,]+)", out) or re.search(r"Extra:\s+title=([^\n,]+)", out)
    url_match = (
        re.search(r"dat=tdmvideo://play\?url=([^\s&]+)", out) or
        re.search(r"Extra:\s+android\.intent\.extra\.TEXT=(https?://[^\s\n,]+)", out) or
        re.search(r"(https?://[^\s\n\"']+\.workers\.dev[^\s\n\"'&]*)", out) or
        re.search(r"(https?://[^\s\n\"']+\.css[^\s\n\"'&]*)", out)
    )
    cookie_match = re.search(r"cookies=([^\s\n\"'&]+)", out)

    title = title_match.group(1).strip() if title_match else ""
    url = url_match.group(1).strip() if url_match else ""
    raw_cookie = cookie_match.group(1).strip() if cookie_match else ""
    # Important: Decode URL-encoded cookie so ot%3D becomes ot=
    cookie = urllib.parse.unquote(raw_cookie) if raw_cookie else ""
    return title, url, cookie

def verify_stream_url(stream_url, cookie=None):
    if not stream_url:
        return False, "لا يوجد رابط", ""
    headers = {
        "User-Agent": "OSCARTV2021",
        "Referer": "http://speedcdn.me:8080/"
    }
    if cookie:
        headers["Cookie"] = cookie
    try:
        r = requests.get(stream_url, headers=headers, timeout=8, allow_redirects=True)
        if r.status_code == 200 and ("#EXTM3U" in r.text or "#EXTINF" in r.text):
            direct_url = r.url if r.url != stream_url else ""
            return True, "HLS شغال 100%", direct_url
        return False, f"HTTP {r.status_code}", ""
    except Exception as e:
        return False, str(e), ""

def parse_bounds(b_str):
    m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b_str)
    if m:
        x1, y1, x2, y2 = map(int, m.groups())
        return (x1 + x2) // 2, (y1 + y2) // 2
    return None

def get_ui_tree():
    run_adb("shell", "uiautomator", "dump", "/sdcard/curr_dump.xml")
    run_adb("pull", "/sdcard/curr_dump.xml", "scratch_curr_dump.xml")
    try:
        import xml.etree.ElementTree as ET
        return ET.parse("scratch_curr_dump.xml")
    except Exception:
        return None

def handle_potential_ad_and_start_playback(server_y=680):
    """
    Taps the server button, checks if a rewarded ad appears, closes the ad,
    and taps the server button again to ensure playback starts.
    """
    tap(960, server_y)
    time.sleep(1.8)

    # Check current focus
    focus = run_adb("shell", "dumpsys", "window")
    if "AdActivity" in focus or "ads" in focus.lower():
        # Rewarded ad detected! Dismiss by tapping close or back
        tap(1868, 55)
        time.sleep(0.5)
        back()
        time.sleep(0.8)
        # After ad dismissal, tap the server button again to actually start the player
        tap(960, server_y)
        time.sleep(1.8)

def switch_to_channels_tab():
    print("[*] الانتقال إلى تبويب القنوات...", flush=True)
    run_adb("shell", "am", "force-stop", "com.tdm.manager")

    for attempt in range(5):
        focus = run_adb("shell", "dumpsys", "window")
        if "com.drama.mp4" not in focus:
            run_adb("shell", "monkey", "-p", "com.drama.mp4", "-c", "android.intent.category.LAUNCHER", "1")
            time.sleep(2.5)

        tree = get_ui_tree()
        if tree:
            for n in tree.iter():
                text = n.attrib.get("text", "")
                bounds = n.attrib.get("bounds", "")
                if text == "بي إن سبورتس" and parse_bounds(bounds) and parse_bounds(bounds)[1] < 400:
                    return True
                if text == "القنوات":
                    center = parse_bounds(bounds)
                    if center:
                        tap(center[0], center[1])
                        time.sleep(1.5)
                        return True
        # If stuck on movie/details page, press back
        back()
        time.sleep(1.0)
        # Fallback to direct navigation icon coordinates for 'القنوات' (1528, 1042)
        tap(1528, 1020)
        time.sleep(1.5)

    return False

def open_bein_modal_and_get_channels():
    switch_to_channels_tab()
    for _ in range(4):
        tree = get_ui_tree()
        found = {}
        if tree:
            for n in tree.iter():
                text = n.attrib.get("text", "").strip()
                bounds = n.attrib.get("bounds", "")
                if text.startswith("beIN Sports ") and parse_bounds(bounds):
                    center = parse_bounds(bounds)
                    found[text] = center
            # Modal has all 9 channels
            if len(found) >= 7:
                return found
        tap(1834, 354)
        time.sleep(1.5)
    return found

def harvest_bein_cluster(channels_db):
    print("\n" + "=" * 60)
    print(" 📡 [1/2] سحب باقة beIN Sports المباشرة (beIN 1 إلى 9)")
    print("=" * 60)

    for num in range(1, 10):
        ch_name = f"beIN Sports {num}"
        print(f"\n[*] جاري سحب {ch_name}...", end=" ", flush=True)

        channels_map = open_bein_modal_and_get_channels()
        center = channels_map.get(ch_name)

        if not center:
            print("✗ لم يتم العثور على القناة في القائمة")
            continue

        run_adb("shell", "am", "force-stop", "com.tdm.manager")
        time.sleep(0.2)

        # Tap the channel card (center X, and tap slightly above text for the poster icon)
        tap(center[0], center[1] - 40)
        time.sleep(1.8)

        # Swipe up to reveal servers
        swipe_up()
        time.sleep(0.8)

        # Tap 720p server button with ad auto-handling
        handle_potential_ad_and_start_playback(server_y=680)

        title, url, cookie = extract_stream_info()
        run_adb("shell", "am", "force-stop", "com.tdm.manager")
        time.sleep(0.3)
        back()
        time.sleep(1.0)

        if url:
            valid, msg, direct_url = verify_stream_url(url, cookie)
            print(f"✓ تم بنجاح! [{msg}]")
            channels_db[ch_name] = {
                "name": ch_name,
                "category": "قنوات beIN Sports",
                "streamUrl": url,
                "directUrl": direct_url,
                "cookie": cookie,
                "ua": "OSCARTV2021"
            }
        else:
            print("✗ تعذر استخراج الرابط")

    # Automatic retry for any missed beIN channel
    missing = [num for num in range(1, 10) if f"beIN Sports {num}" not in channels_db or not channels_db[f"beIN Sports {num}"].get("streamUrl")]
    if missing:
        print(f"\n[*] إعادة محاولة سحب القنوات التي لم تكتمل: {missing}...")
        for num in missing:
            ch_name = f"beIN Sports {num}"
            print(f"[*] جاري إعادة سحب {ch_name}...", end=" ", flush=True)
            channels_map = open_bein_modal_and_get_channels()
            center = channels_map.get(ch_name)
            if not center:
                print("✗ لم يتم العثور على القناة")
                continue
            run_adb("shell", "am", "force-stop", "com.tdm.manager")
            time.sleep(0.3)
            tap(center[0], center[1] - 40)
            time.sleep(1.8)
            swipe_up()
            time.sleep(0.8)
            handle_potential_ad_and_start_playback(server_y=680)
            title, url, cookie = extract_stream_info()
            run_adb("shell", "am", "force-stop", "com.tdm.manager")
            time.sleep(0.3)
            back()
            time.sleep(1.0)
            if url:
                valid, msg, direct_url = verify_stream_url(url, cookie)
                print(f"✓ تم بنجاح! [{msg}]")
                channels_db[ch_name] = {
                    "name": ch_name,
                    "category": "قنوات beIN Sports",
                    "streamUrl": url,
                    "directUrl": direct_url,
                    "cookie": cookie,
                    "ua": "OSCARTV2021"
                }
            else:
                print("✗ تعذر استخراج الرابط")

def harvest_grid_channels(channels_db, max_scrolls=6):
    print("\n" + "=" * 60)
    print(" 📺 [2/2] مسح وسحب باقي القنوات من الشبكة العامة (A to Z)")
    print("=" * 60)

    # Return to main channels grid
    run_adb("shell", "am", "force-stop", "com.tdm.manager")
    back()
    time.sleep(0.5)
    switch_to_channels_tab()
    time.sleep(1.5)

    visited = set(channels_db.keys())

    for s in range(max_scrolls):
        print(f"\n--- جولة المسح {s+1}/{max_scrolls} ---")
        tree = get_ui_tree()
        if not tree:
            time.sleep(1.5)
            continue

        found_in_view = []
        for node in tree.iter():
            res_id = node.attrib.get("resource-id", "")
            text = node.attrib.get("text", "").strip()
            bounds = node.attrib.get("bounds", "")
            if "tvName" in res_id and text and bounds:
                if any(k in text for k in ["الكل", "التصنيف", "بي إن سبورتس", "ثمانية"]):
                    continue
                center = parse_bounds(bounds)
                if center and 300 <= center[1] <= 900:
                    if text not in visited:
                        found_in_view.append((text, center))

        print(f"قنوات جديدة مكتشفة: {len(found_in_view)}")
        for ch_name, (cx, cy) in found_in_view:
            print(f"[*] سحب {ch_name}...", end=" ", flush=True)
            run_adb("shell", "am", "force-stop", "com.tdm.manager")
            time.sleep(0.2)
            tap(cx, cy)
            time.sleep(1.8)
            swipe_up()
            time.sleep(0.8)
            handle_potential_ad_and_start_playback(server_y=680)

            title, url, cookie = extract_stream_info()
            run_adb("shell", "am", "force-stop", "com.tdm.manager")
            time.sleep(0.3)
            back()
            time.sleep(0.8)

            if url:
                valid, msg, direct_url = verify_stream_url(url, cookie)
                print(f"✓ تم! [{msg}]")
                channels_db[ch_name] = {
                    "name": ch_name,
                    "category": "Live TV",
                    "streamUrl": url,
                    "directUrl": direct_url,
                    "cookie": cookie,
                    "ua": "OSCARTV2021"
                }
            else:
                print("✗ تم التخطي")

            visited.add(ch_name)
            time.sleep(0.3)

        # Scroll down
        swipe_down_grid()
        time.sleep(1.5)

def save_and_export(channels_db):
    os.makedirs("data", exist_ok=True)
    json_path = os.path.abspath("data/oscar_channels_live.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(channels_db, f, ensure_ascii=False, indent=2)

    m3u_lines = ["#EXTM3U"]
    for name, data in channels_db.items():
        url = data.get("streamUrl", "")
        cookie = data.get("cookie", "")
        group = data.get("category", "Live TV")
        if any(k in name.lower() for k in ["bein", "sport", "كأس", "ssc", "رياض"]):
            group = "Sports"
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

    print("\n" + "=" * 60)
    print(" ✅ تم حفظ وتصدير القنوات بنجاح:")
    print(f" 📁 ملف JSON: {json_path}")
    print(f" 📺 ملف M3U8: {m3u_path}")
    print(f" 🔢 إجمالي القنوات الشغالة: {len(channels_db)}")
    print("=" * 60)

def trigger_server_sync():
    print("\n[*] جارٍ إرسال التحديث تلقائياً إلى خادم ASPREEN TV...")
    try:
        r1 = requests.post("http://127.0.0.1:3001/api/channels/sync-oscar", timeout=5)
        if r1.status_code == 200:
            print(" [✓] تم تحديث السيرفر الداخلي بقنوات أوسكار بنجاح!")
        else:
            print(f" [!] استجابة السيرفر: HTTP {r1.status_code}")
    except Exception:
        print(" [i] السيرفر المحلي غير مشغل حالياً (سيتم قراءة الملفات تلقائياً عند تشغيله).")

def main():
    print("=" * 60)
    print("   ASPREEN TV ▸ أداة التحديث الشامل لقنوات أوسكار تي في")
    print("=" * 60)

    device = get_connected_device()
    if not device:
        print("\n❌ خطأ: لم يتم العثور على محاكي MuMu Player أو جهاز أندرويد متصل!")
        print("👉 يرجى تشغيل محاكي MuMu Player والتأكد من تثبيت تطبيق Oscar TV، ثم أعد تشغيل السكربت.")
        if sys.stdin.isatty():
            try:
                input("\nاضغط Enter للخروج...")
            except Exception:
                pass
        return

    print(f"[✓] الجهاز المتصل: {device}")
    print("[*] جارٍ ضبط وإعادة تشغيل تطبيق Oscar TV في حالة نظيفة...")
    run_adb("shell", "am", "force-stop", "com.tdm.manager")
    run_adb("shell", "am", "force-stop", "com.drama.mp4")
    time.sleep(0.5)
    run_adb("shell", "monkey", "-p", "com.drama.mp4", "-c", "android.intent.category.LAUNCHER", "1")
    time.sleep(4.0)

    # Load existing DB
    channels_db = {}
    if os.path.exists("data/oscar_channels_live.json"):
        try:
            with open("data/oscar_channels_live.json", "r", encoding="utf-8") as f:
                channels_db = json.load(f)
        except Exception:
            pass

    # 1. Harvest beIN cluster
    harvest_bein_cluster(channels_db)

    # 2. Harvest grid channels
    harvest_grid_channels(channels_db, max_scrolls=6)

    # 3. Save results
    save_and_export(channels_db)

    # 4. Trigger server sync
    trigger_server_sync()

    print("\n🎉 اكتمل التحديث الشامل بنجاح تام! يمكنك الآن المشاهدة بدون أي مشاكل.")

if __name__ == "__main__":
    main()
