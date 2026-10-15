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
    # Fallback search
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

    # 1. Stop TDM to clear old intent
    run_adb("shell", "am", "force-stop", "com.tdm.manager")

    # 2. Tap channel card
    tap(cx, cy)
    time.sleep(2.0)

    # 3. Swipe up to reveal servers
    run_adb("shell", "input", "swipe", "960", "900", "960", "250", "300")
    time.sleep(1.2)

    # 4. Find server buttons by ID or text
    tree = get_ui_tree()
    target_pos = None
    if tree:
        # First priority: find 1080p or 720p or any tvQuality
        candidates = []
        for node in tree.iter():
            text = node.attrib.get("text", "")
            res_id = node.attrib.get("resource-id", "")
            bounds = node.attrib.get("bounds", "")
            if not bounds:
                continue
            if any(q in text for q in ["1080p", "720p", "480p", "360p"]):
                candidates.append((text, bounds))
            elif "tvServerName" in res_id or "tvQuality" in res_id:
                candidates.append((text, bounds))

        # Pick best candidate
        for pref in ["1080p", "720p", "480p", "360p"]:
            for t, b in candidates:
                if pref in t:
                    target_pos = parse_bounds(b)
                    print(f"  [+] Found server: {t} at {target_pos}", flush=True)
                    break
            if target_pos:
                break
        
        if not target_pos and candidates:
            target_pos = parse_bounds(candidates[0][1])
            print(f"  [+] Using first candidate: {candidates[0][0]} at {target_pos}", flush=True)

    if not target_pos:
        # Fallback coordinate where 720p/1080p usually sits
        target_pos = (960, 710)
        print("  [!] Using default server position (960, 710)", flush=True)

    # 5. Tap server button
    tap(target_pos[0], target_pos[1])
    time.sleep(3.5)

    # 6. Extract intent
    stream_url, title = extract_stream_from_intent()
    if stream_url:
        print(f"  [>>>] SUCCESS: {ch_name} -> {stream_url}", flush=True)
    else:
        print(f"  [---] Failed to capture stream for {ch_name}", flush=True)

    # 7. Exit player and return
    double_back()
    time.sleep(0.8)
    # Tap back arrow at top-right
    tap(1860, 90)
    time.sleep(1.2)

    return stream_url

def harvest_all_visible_in_category(category_name, db):
    print(f"\n==========================================", flush=True)
    print(f"[*] Processing Category: {category_name}", flush=True)
    print(f"==========================================", flush=True)

    # Scan channels on screen, then scroll down and scan again
    visited_names = set(db.keys())

    for page in range(3): # check up to 3 vertical pages per category
        tree = get_ui_tree()
        if not tree:
            break

        visible = []
        for node in tree.iter():
            res_id = node.attrib.get("resource-id", "")
            text = node.attrib.get("text", "").strip()
            bounds = node.attrib.get("bounds", "")
            if "tvName" in res_id and text and bounds:
                # Exclude top category tabs
                if any(c in text for c in ["بي إن سبورتس", "ستارز بلاي", "ألوان", "ثمانية", "إم بي سي", "أون سبورتس", "الكأس", "شاهد", "العراقية", "الجزائرية", "الكل", "التصنيف"]):
                    continue
                if text not in visited_names:
                    visible.append((text, bounds))

        if not visible:
            print(f"[*] No new channels on page {page+1}, done with {category_name}.", flush=True)
            break

        print(f"[*] Page {page+1}: Found {len(visible)} new channels to harvest", flush=True)
        for ch_name, bounds in visible:
            url = harvest_single_channel(ch_name, bounds)
            if url:
                db[ch_name] = {
                    "name": ch_name,
                    "category": category_name,
                    "streamUrl": url,
                    "ua": "OSCARTV2021"
                }
                save_results(db)
            visited_names.add(ch_name)
            time.sleep(0.5)

        # Scroll down to reveal more channels in this category
        print("[*] Scrolling down channel grid...", flush=True)
        run_adb("shell", "input", "swipe", "960", "900", "960", "350", "400")
        time.sleep(1.5)

def save_results(data):
    os.makedirs("data", exist_ok=True)
    with open("data/oscar_channels_live.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    # Generate M3U8
    m3u_lines = ["#EXTM3U"]
    for name, item in data.items():
        url = item.get("streamUrl", "")
        cat = item.get("category", "Live TV")
        m3u_lines.append(f'#EXTINF:-1 group-title="{cat}" tvg-name="{name}",{name}')
        m3u_lines.append(url)
    with open("data/oscar_channels.m3u8", "w", encoding="utf-8") as f:
        f.write("\n".join(m3u_lines) + "\n")

if __name__ == "__main__":
    db = {}
    if os.path.exists("data/oscar_channels_live.json"):
        try:
            with open("data/oscar_channels_live.json", encoding="utf-8") as f:
                db = json.load(f)
        except Exception:
            pass

    # Run on current category
    harvest_all_visible_in_category("بي إن سبورتس", db)
    print(f"\n[*] Finished! Total channels in database: {len(db)}")
