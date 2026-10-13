import subprocess
import time
import re
import os
import sys
import json
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")

ADB = r"C:\Users\Admin\AppData\Local\Android\Sdk\platform-tools\adb.exe"
DEVICE = "192.168.0.106:5555"

def run_adb(*args):
    cmd = [ADB, "-s", DEVICE] + list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    return res.stdout

def tap(x, y):
    run_adb("shell", "input", "tap", str(x), str(y))

def back():
    run_adb("shell", "input", "keyevent", "4")

def double_back():
    run_adb("shell", "input", "keyevent", "4")
    time.sleep(0.35)
    run_adb("shell", "input", "keyevent", "4")

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
        return ET.parse("scratch_curr_dump.xml")
    except Exception as e:
        return None

def extract_stream_from_intent():
    out = run_adb("shell", "dumpsys", "activity", "a", "com.tdm.manager/.activity.VideoPlayerActivity")
    m = re.search(r"dat=tdmvideo://play\?url=([^\s&]+)", out)
    if m:
        url = m.group(1)
        m_title = re.search(r"title=([^\s&]+)", out)
        title = m_title.group(1) if m_title else ""
        return url, title
    out_all = run_adb("shell", "dumpsys", "activity", "activities")
    m2 = re.search(r"dat=tdmvideo://play\?url=([^\s&]+)", out_all)
    if m2:
        return m2.group(1), ""
    return None, None

def harvest_single_channel(ch_name, ch_bounds):
    center = parse_bounds(ch_bounds)
    if not center:
        return None
    cx, cy = center
    print(f"\n[*] Harvesting: {ch_name} at ({cx}, {cy})...", flush=True)

    # Force-stop TDM to ensure only new intent is observed
    run_adb("shell", "am", "force-stop", "com.tdm.manager")

    # 1. Tap channel card
    tap(cx, cy)
    time.sleep(2.2)

    # 2. Swipe up to reveal servers
    run_adb("shell", "input", "swipe", "960", "900", "960", "250", "300")
    time.sleep(1.2)

    # 3. Find server buttons
    tree = get_ui_tree()
    target_pos = None
    if tree:
        candidates = []
        for node in tree.iter():
            text = node.attrib.get("text", "")
            res_id = node.attrib.get("resource-id", "")
            bounds = node.attrib.get("bounds", "")
            if not bounds:
                continue
            if any(q in text for q in ["1080p", "720p", "480p", "360p", "سيرفر", "مباشر"]):
                candidates.append((text, bounds))
            elif "tvServerName" in res_id or "tvQuality" in res_id:
                candidates.append((text, bounds))

        for pref in ["1080p", "720p", "480p", "360p", "مباشر"]:
            for t, b in candidates:
                if pref in t:
                    target_pos = parse_bounds(b)
                    print(f"  [+] Found server: {t} at {target_pos}", flush=True)
                    break
            if target_pos:
                break

        if not target_pos and candidates:
            target_pos = parse_bounds(candidates[0][1])
            print(f"  [+] Using server candidate: {candidates[0][0]} at {target_pos}", flush=True)

    if not target_pos:
        target_pos = (960, 710)
        print("  [!] Using fallback server position (960, 710)", flush=True)

    # 4. Tap server button
    tap(target_pos[0], target_pos[1])
    time.sleep(3.5)

    # 5. Extract intent
    stream_url, title = extract_stream_from_intent()
    if stream_url:
        print(f"  [>>>] SUCCESS: {ch_name} -> {stream_url}", flush=True)
    else:
        print(f"  [---] Failed to capture stream for {ch_name}", flush=True)

    # 6. Exit player and return to channel grid
    double_back()
    time.sleep(0.8)
    tap(1860, 90)
    time.sleep(1.2)

    # Safety: ensure we are on the channels grid (tap channels bottom nav if needed)
    return stream_url

def save_results(data):
    os.makedirs("data", exist_ok=True)
    with open("data/oscar_channels_live.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    m3u_lines = ["#EXTM3U"]
    for name, item in data.items():
        url = item.get("streamUrl", "")
        cat = item.get("category", "Live TV")
        m3u_lines.append(f'#EXTINF:-1 group-title="{cat}" tvg-name="{name}",{name}')
        m3u_lines.append(url)
    with open("data/oscar_channels.m3u8", "w", encoding="utf-8") as f:
        f.write("\n".join(m3u_lines) + "\n")

def run_crawler():
    db = {}
    if os.path.exists("data/oscar_channels_live.json"):
        try:
            with open("data/oscar_channels_live.json", encoding="utf-8") as f:
                db = json.load(f)
        except Exception:
            pass

    visited_names = set(db.keys())
    print(f"[*] Starting Master Crawler with {len(visited_names)} existing channels in DB...", flush=True)

    # Scan and scroll 10 times to capture all channels in the grid
    for scroll_idx in range(12):
        print(f"\n==========================================", flush=True)
        print(f"[*] Grid Pass {scroll_idx + 1}/12", flush=True)
        print(f"==========================================", flush=True)

        tree = get_ui_tree()
        if not tree:
            time.sleep(2)
            continue

        channels_on_screen = []
        for node in tree.iter():
            res_id = node.attrib.get("resource-id", "")
            text = node.attrib.get("text", "").strip()
            bounds = node.attrib.get("bounds", "")
            if "tvName" in res_id and text and bounds:
                # Exclude category bar items
                if any(c in text for c in ["بي إن سبورتس", "ستارز بلاي", "ألوان", "ثمانية", "إم بي سي", "أون سبورتس", "الكأس", "شاهد", "العراقية", "الجزائرية", "الكل", "التصنيف"]):
                    continue
                center = parse_bounds(bounds)
                if center:
                    cx, cy = center
                    # Only click items safely in the middle of the screen (cy between 300 and 920)
                    if 300 <= cy <= 920:
                        if text not in visited_names:
                            channels_on_screen.append((text, bounds))

        print(f"[*] Channels found in view: {len(channels_on_screen)}", flush=True)
        for ch_name, bounds in channels_on_screen:
            url = harvest_single_channel(ch_name, bounds)
            if url:
                db[ch_name] = {
                    "name": ch_name,
                    "streamUrl": url,
                    "ua": "OSCARTV2021"
                }
                save_results(db)
            visited_names.add(ch_name)
            time.sleep(0.5)

        # Scroll down channel grid
        print("[*] Scrolling down channel grid...", flush=True)
        run_adb("shell", "input", "swipe", "960", "800", "960", "300", "400")
        time.sleep(2.0)

    print(f"\n[*] Master Crawler Complete! Total channels captured: {len(db)}", flush=True)

if __name__ == "__main__":
    run_crawler()
