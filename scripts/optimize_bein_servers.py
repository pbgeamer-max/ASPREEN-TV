# -*- coding: utf-8 -*-
"""
=============================================================================
  ASPREEN TV ▸ Optimize beIN Sports Server Order
  جعل السيرفر عالي الوضوح وسريع الاستجابة (HD 720p 50/60fps) هو الافتراضي
=============================================================================
"""

import os
import re
import sys
import json

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHANNELS_FILES = [
    os.path.join(WORKSPACE_DIR, "channels.json"),
    os.path.join(WORKSPACE_DIR, "apps", "api", "channels.json"),
    os.path.join(WORKSPACE_DIR, "data", "channels_multiserver.json"),
]

def optimize():
    for fpath in CHANNELS_FILES:
        if not os.path.exists(fpath):
            continue
        with open(fpath, "r", encoding="utf-8") as f:
            channels = json.load(f)

        changed_count = 0
        for ch in channels:
            cid = ch.get("id", "")
            if not ("bein" in cid.lower() or "bein" in ch.get("name", "").lower()):
                continue

            servers = ch.get("servers", [])
            if len(servers) < 2:
                continue

            # Preference: 1) HD 720p (exact HD quality), 2) HD S1, 3) 1080p, 4) UHD
            for i, s in enumerate(servers):
                sname = s.get("name", "").upper()
                squal = s.get("quality", "").upper()
                if squal == "HD" or ("720P" in sname and "S2" not in sname and "S3" not in sname):
                    best_idx = i
                    break

            if best_idx == -1:
                for i, s in enumerate(servers):
                    sname = s.get("name", "").upper()
                    if "HD" in sname and "UHD" not in sname and "S2" not in sname:
                        best_idx = i
                        break

            if best_idx > 0:
                # Move the best stable stream to index 0
                best_server = servers.pop(best_idx)
                servers.insert(0, best_server)

                # Re-index server IDs and URLs
                for idx, s in enumerate(servers, start=1):
                    s["id"] = f"server-{idx}"
                    s["url"] = f"/live/{cid}.m3u8?server={idx}"
                    s["isDefault"] = (idx == 1)
                    # Clean up names
                    old_name = s.get("name", "")
                    clean_title = re.sub(r"^سيرفر\s*\d+\s*[-–:]*\s*", "", old_name).strip()
                    if idx == 1:
                        s["name"] = f"سيرفر 1 - فائق الثبات وسلس ({clean_title})"
                    else:
                        s["name"] = f"سيرفر {idx} - {clean_title}"

                # Update channel top-level defaults
                ch["servers"] = servers
                top_upstream = servers[0].get("upstreamUrl", "")
                if top_upstream:
                    ch["directM3u8"] = top_upstream
                ch["streamUrl"] = f"/live/{cid}.m3u8?server=1"
                ch["playUrl"] = f"/live/{cid}.m3u8?server=1"
                changed_count += 1

        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(channels, f, ensure_ascii=False, indent=2)

        print(f" [✓] تم تحسين ترتيب سيرفرات {changed_count} قناة beIN في {os.path.basename(fpath)}")

    # Update root channels.m3u and channels.m3u8
    root_json = os.path.join(WORKSPACE_DIR, "channels.json")
    if os.path.exists(root_json):
        with open(root_json, "r", encoding="utf-8") as f:
            all_channels = json.load(f)
        m3u_lines = ["#EXTM3U"]
        for ch in all_channels:
            cid = ch.get("id") or ch.get("vid")
            name = ch.get("name", "Channel").replace('"', "'")
            group = ch.get("groupTitle", "Live TV").replace('"', "'")
            logo = ch.get("logoUrl", "")
            proxy_url = f"http://127.0.0.1:8088/live/{cid}.m3u8"
            extinf = f'#EXTINF:-1 tvg-id="{cid}" tvg-name="{name}" tvg-logo="{logo}" group-title="{group}",{name}'
            m3u_lines.append(extinf)
            m3u_lines.append(proxy_url)
        content = "\n".join(m3u_lines) + "\n"
        for p in [os.path.join(WORKSPACE_DIR, "channels.m3u"), os.path.join(WORKSPACE_DIR, "channels.m3u8")]:
            with open(p, "w", encoding="utf-8") as f:
                f.write(content)
        print(" [✓] تم تحديث ملفات channels.m3u و channels.m3u8 بنجاح.")

if __name__ == "__main__":
    optimize()
