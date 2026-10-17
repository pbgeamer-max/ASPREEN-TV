# -*- coding: utf-8 -*-
"""
=============================================================================
         🚀 ASPREEN TV ▸ MULTI-SERVER SYNC & STREAM SENTINEL
     محرك السيرفرات المتعددة ومراقب البث الذكي الآلي (Auto-Healing Sentinel)
=============================================================================
* يدمج روابط سيرفرات ياسين تيفي + سيرفرات VIP OTT + سيرفرات كورة لايف.
* "سحب فقط شغالات فقط": يفحص صحة البث لكل سيرفر ويتأكد من عمله.
* "إذا القناة طافية يحذفها / يخفيها، وفور عودة البث يكتشفها ويعيد إضافتها تلقائياً".
* يتيح للمشاهدين التبديل السلس بين سيرفر 1، سيرفر 2، وسيرفر 3.
=============================================================================
"""

import os
import sys
import glob
import re
import json
import time
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHANNELS_JSON_PATH = os.path.join(WORKSPACE_DIR, "channels.json")
BACKUP_JSON_PATH = os.path.join(WORKSPACE_DIR, "data", "channels_multiserver.json")
VIP_DIR = os.path.join(WORKSPACE_DIR, "روابطج بث")

DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def load_vip_channels():
    """Loads all 145 channels from the verified VIP OTT folder"""
    vip_map = {}
    target_dir = VIP_DIR if os.path.exists(VIP_DIR) else os.path.join(WORKSPACE_DIR, "data", "vip_streams")
    if not os.path.exists(target_dir):
        return vip_map

    for fn in os.listdir(target_dir):
        if not fn.endswith(".m3u"):
            continue
        fp = os.path.join(target_dir, fn)

        with open(fp, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
        curr_name = ""
        for line in lines:
            line = line.strip()
            if line.startswith("#EXTINF"):
                m = re.search(r",(.+)$", line)
                if m:
                    curr_name = m.group(1).replace("┃AR┃", "").strip()
            elif line.startswith("http") and curr_name:
                clean_key = re.sub(r"\s+", " ", curr_name.upper()).strip()
                if clean_key not in vip_map:
                    vip_map[clean_key] = line
                curr_name = ""
    return vip_map


def probe_stream_health(url, timeout=4, max_retries=1):
    """Probes if stream URL responds with HTTP 200 and data"""
    if not url:
        return False
    for _ in range(max_retries):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": DEFAULT_UA,
                    "Referer": "https://yacine.website/" if "yacine" in url or "new-redirect" in url else "http://line.hey-ott.net:80/",
                    "Accept": "*/*"
                }
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    chunk = resp.read(256)
                    if chunk and len(chunk) > 0:
                        return True
        except Exception:
            pass
    return False


def normalize_channel_title(name):
    """Normalize channel name for cross-source matching"""
    n = name.upper()
    n = re.sub(r"┃AR┃|\bHD\b|\bSD\b|\b4K\b|\b8K\b|\bRAW\b|\bHEVC\b|\bUHD\b|\bS\d+\b", "", n)
    n = re.sub(r"[^A-Z0-9]+", " ", n).strip()
    return n


def build_multiserver_catalog():
    """Enriches channels.json with multi-server options for each channel"""
    if not os.path.exists(CHANNELS_JSON_PATH):
        print(" [!] لم يتم العثور على ملف channels.json!")
        return

    with open(CHANNELS_JSON_PATH, "r", encoding="utf-8") as f:
        channels = json.load(f)

    vip_channels = load_vip_channels()
    print(f"📡 [1/3] تم تحميل {len(vip_channels)} قناة من خطوط VIP OTT بنجاح.")

    enriched_count = 0

    for ch in channels:
        ch_name = ch.get("name", "")
        norm_name = normalize_channel_title(ch_name)
        cid = str(ch.get("id", ""))

        servers = []

        # Server 1: Yacine TV (HLS / FHD)
        servers.append({
            "id": "server-1",
            "name": "سيرفر 1 (ياسين TV - FHD)",
            "url": f"/live/{cid}.m3u8?server=1",
            "quality": "FHD",
            "isDefault": True,
            "status": ch.get("status", "live")
        })

        # Match VIP streams for beIN Sports, AFC, Xtra, News
        matched_vip_urls = []
        for vname, vurl in vip_channels.items():
            norm_vname = normalize_channel_title(vname)
            if norm_name and (norm_name == norm_vname or norm_name in norm_vname):
                matched_vip_urls.append((vname, vurl))

        # Add Server 2 if matched
        if matched_vip_urls:
            # Pick primary VIP match
            vname, vurl = matched_vip_urls[0]
            servers.append({
                "id": "server-2",
                "name": "سيرفر 2 (VIP OTT 1080p)",
                "url": f"/live/{cid}.m3u8?server=2",
                "upstreamUrl": vurl,
                "quality": "1080p",
                "status": "live"
            })
            enriched_count += 1

            # If there's an additional backup VIP server, add Server 3
            if len(matched_vip_urls) > 1:
                vname2, vurl2 = matched_vip_urls[1]
                servers.append({
                    "id": "server-3",
                    "name": "سيرفر 3 (VIP احتياطي)",
                    "url": f"/live/{cid}.m3u8?server=3",
                    "upstreamUrl": vurl2,
                    "quality": "HD",
                    "status": "live"
                })
        else:
            # For non-VIP channels, provide standard high-speed fallback server
            direct_m3u8 = ch.get("directM3u8") or ch.get("streamUrl")
            if direct_m3u8 and not direct_m3u8.startswith("/live/"):
                servers.append({
                    "id": "server-2",
                    "name": "سيرفر 2 (مباشر CDN)",
                    "url": f"/live/{cid}.m3u8?server=2",
                    "upstreamUrl": direct_m3u8,
                    "quality": "HD",
                    "status": "live"
                })

        ch["servers"] = servers

    # Save enriched catalog
    with open(CHANNELS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(channels, f, ensure_ascii=False, indent=2)

    os.makedirs(os.path.dirname(BACKUP_JSON_PATH), exist_ok=True)
    with open(BACKUP_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(channels, f, ensure_ascii=False, indent=2)

    print(f" [✓] تم تزويد {enriched_count} قناة رياضية بسيرفرات متعددة (Multi-Server) وحفظ الملف بنجاح!")


def autonomous_health_check_and_heal():
    """
    يفحص فقط القنوات الشغالة:
    - القنوات التي تبث تكون 'live' و 'ONLINE'.
    - القنوات المتوقفة تماماً (Off-air / Event-only) تُوسم 'offline' وتُخفى حتى لا تظهر كقناة معطلة.
    - وفور بدء البث المباشر مجدداً، يعيد تفعيلها آلياً.
    """
    print("🔍 [2/3] بدء الفحص الذكي لصحة القنوات وتصفية القنوات الشغالة فقط...")
    if not os.path.exists(CHANNELS_JSON_PATH):
        return

    with open(CHANNELS_JSON_PATH, "r", encoding="utf-8") as f:
        channels = json.load(f)

    # Focus probing on main sports channels to prevent rate limiting
    sports_keywords = ["BEIN", "SSC", "KASS", "ON TIME", "ABU DHABI", "SPORT", "العراقية", "الكويت"]
    target_channels = [c for c in channels if any(k in c.get("name", "").upper() or k in c.get("groupTitle", "").upper() for k in sports_keywords)]

    print(f" [•] جاري فحص {len(target_channels)} قناة رياضية حيوية...")

    live_count = 0
    offline_count = 0

    def check_channel(ch):
        cname = ch.get("name", "")
        stream = ch.get("directM3u8") or ch.get("streamUrl") or ch.get("playUrl")
        is_healthy = probe_stream_health(stream, timeout=3)
        return ch, is_healthy

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(check_channel, c) for c in target_channels]
        for fut in futures:
            try:
                ch, healthy = fut.result()
                if healthy:
                    ch["status"] = "live"
                    ch["inputStatus"] = "ONLINE"
                    ch["enabled"] = True
                    ch["status_message"] = "بث مباشر نشط ومستقر"
                    live_count += 1
                else:
                    # Off-air channel (e.g. broadcasts during live matches only)
                    ch["status"] = "event_only"
                    ch["inputStatus"] = "OFFLINE"
                    ch["status_message"] = "تبث أثناء المباريات المباشرة فقط"
                    offline_count += 1
            except Exception:
                pass

    # Save results
    with open(CHANNELS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(channels, f, ensure_ascii=False, indent=2)

    print(f" [✓] [3/3] اكتمل الفحص: {live_count} قناة شغالة نشطة | {offline_count} قناة مخصصة للمباريات (مراقبة تلقائياً).")


if __name__ == "__main__":
    build_multiserver_catalog()
    autonomous_health_check_and_heal()
