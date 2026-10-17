# -*- coding: utf-8 -*-
"""
=============================================================================
     🚀 ASPREEN TV ▸ UPGRADE BEIN SPORTS TO 100% STABLE HLS STREAMS
=============================================================================
* يستبدل سيرفرات بي إن سبورت التي تقطع كل 30 ثانية بسيرفرات HLS نقية وفائقة الثبات
* يجعل سيرفر 1 (الافتراضي) يسحب مباشرة من بث HLS المستمر الذي لا يفصل نهائياً
* يحتفظ بسيرفر hey-ott كسيرفر احتياطي بديل (سيرفر 2)
=============================================================================
"""

import os
import sys
import re
import json
import time
import ssl
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHANNELS_JSON_PATH = os.path.join(WORKSPACE_DIR, "channels.json")
API_CHANNELS_JSON_PATH = os.path.join(WORKSPACE_DIR, "apps", "api", "channels.json")
DATA_CHANNELS_PATH = os.path.join(WORKSPACE_DIR, "data", "channels_multiserver.json")
YACINE_JSON_PATH = os.path.join(WORKSPACE_DIR, "data", "yacine_channels.json")

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

BEIN_MAPPING = {
    'bein-vip-bein-sports-news': '207119423119893112',
    'bein-vip-bein-sports-global': '207119423119893112',
    'bein-vip-bein-sports-1': '207119423132628321',
    'bein-vip-bein-sports-2': '207119423133708072',
    'bein-vip-bein-sports-3': '207119423130423959',
    'bein-vip-bein-sports-4': '207119423131118230',
    'bein-vip-bein-sports-5': '207119423128371685',
    'bein-vip-bein-sports-6': '207119423129963420',
    'bein-vip-bein-sports-7': '207119423126609442',
    'bein-vip-bein-sports-8': '207119423126943987',
    'bein-vip-bein-sports-9': '207119423124591988',
    'bein-vip-bein-sports-1-english': '207119423176013182',
    'bein-vip-bein-sports-2-english': '207119423172165897',
    'bein-vip-bein-sports-1-france': '207119423125528797',
    'bein-vip-bein-sports-2-france': '207119423122362278',
    'bein-vip-bein-sports-3-france': '207119423123144615',
}

def fetch_yacine_stream(y_id):
    api_url = f"https://yacine.website/index.php?get_channel_stream={y_id}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36',
        'Referer': f'https://yacine.website/channel/{y_id}/live',
        'X-Forwarded-For': '156.200.1.1'
    }
    try:
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req, timeout=10, context=SSL_CTX) as r:
            data = json.loads(r.read().decode('utf-8'))
            if data.get('status') == 'success':
                return data.get('raw_url', ''), data.get('url', ''), data.get('user_agent', '')
    except Exception as e:
        print(f" [!] خطأ في جلب توكن القناة {y_id}: {e}")
    return '', '', ''

def main():
    print("=" * 68)
    print("   🚀 ASPREEN TV ▸ ترقية قنوات beIN Sports إلى HLS فائق الثبات")
    print("=" * 68)

    with open(CHANNELS_JSON_PATH, "r", encoding="utf-8") as f:
        channels = json.load(f)

    updated_count = 0

    for ch in channels:
        cid = ch.get("id")
        y_id = BEIN_MAPPING.get(cid)

        # Also support matching by yacineId or direct ID
        if not y_id and str(cid) in BEIN_MAPPING.values():
            y_id = str(cid)

        if not y_id:
            continue

        cname = ch.get("name")
        print(f"⚡ جارٍ تحديث: {cname} (ID: {cid} -> Yacine: {y_id})...", end="", flush=True)

        raw_url, play_url, ua = fetch_yacine_stream(y_id)
        if not raw_url:
            print(" [فشل في الحصول على الرابط]")
            continue

        ch["yacineId"] = y_id
        ch["directM3u8"] = raw_url
        ch["streamUrl"] = raw_url
        if play_url:
            ch["playUrl"] = play_url if play_url.startswith("http") else f"https://yacine.website{play_url}"
        ch["source"] = "yacine.website"
        ch["userAgent"] = ua or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0 Safari/537.36"
        ch["referer"] = f"https://yacine.website/channel/{y_id}/live"
        ch["status"] = "live"
        ch["lastRenewed"] = time.time()
        ch["status_message"] = "بث مباشر فائق الثبات HLS 24/7"

        # Re-structure servers array
        existing_servers = ch.get("servers", [])
        
        # Keep old non-Yacine servers as backup (servers 2, 3...)
        backup_servers = []
        for s in existing_servers:
            # If server is not already our Yacine server
            if "re300" not in str(s.get("upstreamUrl", "")) and "yacine" not in str(s.get("upstreamUrl", "")):
                s_copy = dict(s)
                s_copy["isDefault"] = False
                backup_servers.append(s_copy)

        new_servers = [
            {
                "id": "server-1",
                "name": "سيرفر 1 (HLS فائق الثبات 24/7)",
                "upstreamUrl": raw_url,
                "url": f"/live/{cid}.m3u8?server=1",
                "quality": "1080p",
                "isDefault": True,
                "status": "live"
            }
        ]

        # Add backups with updated IDs
        for idx, bs in enumerate(backup_servers[:4], start=2):
            bs["id"] = f"server-{idx}"
            bs["url"] = f"/live/{cid}.m3u8?server={idx}"
            if "سيرفر 1" in bs.get("name", ""):
                bs["name"] = bs["name"].replace("سيرفر 1", f"سيرفر {idx} (احتياطي فضائي)")
            new_servers.append(bs)

        ch["servers"] = new_servers
        updated_count += 1
        print(" [✓ تم بنجاح]")
        time.sleep(0.5)

    print(f"\n[✓] تم بنجاح تحديث {updated_count} قناة beIN Sports بروابط HLS دائمة الاستقرار.")

    # Save to channels.json
    with open(CHANNELS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(channels, f, ensure_ascii=False, indent=2)

    # Save to apps/api/channels.json
    if os.path.exists(os.path.dirname(API_CHANNELS_JSON_PATH)):
        with open(API_CHANNELS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(channels, f, ensure_ascii=False, indent=2)

    # Save to data/channels_multiserver.json
    if os.path.exists(os.path.dirname(DATA_CHANNELS_PATH)):
        with open(DATA_CHANNELS_PATH, "w", encoding="utf-8") as f:
            json.dump(channels, f, ensure_ascii=False, indent=2)

    # Update M3U files
    m3u_lines = ["#EXTM3U"]
    for ch in channels:
        cid = ch.get("id") or ch.get("vid")
        name = ch.get("name", "Channel").replace('"', "'")
        group = ch.get("groupTitle", "Live TV").replace('"', "'")
        logo = ch.get("logoUrl", "")
        proxy_url = f"https://aspreen-tv-production.up.railway.app/live/{cid}.m3u8"
        extinf = f'#EXTINF:-1 tvg-id="{cid}" tvg-name="{name}" tvg-logo="{logo}" group-title="{group}",{name}'
        m3u_lines.append(extinf)
        m3u_lines.append(proxy_url)

    m3u_content = "\n".join(m3u_lines) + "\n"
    for m3u_path in [
        os.path.join(WORKSPACE_DIR, "channels.m3u"),
        os.path.join(WORKSPACE_DIR, "channels.m3u8"),
        os.path.join(WORKSPACE_DIR, "channels_railway.m3u"),
    ]:
        with open(m3u_path, "w", encoding="utf-8") as f:
            f.write(m3u_content)

    print(" [✓] تم حفظ كافة ملفات channels.json و channels.m3u و channels_railway.m3u بنجاح.")

if __name__ == "__main__":
    main()
