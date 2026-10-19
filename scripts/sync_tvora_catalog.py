# -*- coding: utf-8 -*-
import json
import re
import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

workspace_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
channels_json_path = os.path.join(workspace_dir, "channels.json")
with open(channels_json_path, "r", encoding="utf-8") as f:
    master_channels = json.load(f)

servers_map = {}
for ch in master_channels:
    cid = ch.get("id") or ch.get("vid")
    if ch.get("servers"):
        clean_servers = []
        for s in ch["servers"]:
            clean_s = dict(s)
            clean_s.pop("upstreamUrl", None)
            u = clean_s.get("url", "")
            if u.startswith("/"):
                clean_s["url"] = f"https://aspreen-tv-production.up.railway.app{u}"
            clean_servers.append(clean_s)
        servers_map[cid] = clean_servers

target_file = os.path.join(workspace_dir, "موقع كرة قدم وافلام", "src", "lib", "catalog-loader.ts")
with open(target_file, "r", encoding="utf-8") as f:
    content = f.read()

match = re.search(r"export const DEFAULT_CHANNELS:\s*Dict\[\]\s*=\s*(\[[\s\S]*?\n\]);", content)
if not match:
    print("Could not find DEFAULT_CHANNELS in catalog-loader.ts")
    sys.exit(1)

channels_data = json.loads(match.group(1))
updated_count = 0
for ch in channels_data:
    cid = ch.get("id")
    if cid in servers_map:
        new_servers = servers_map[cid]
        ch["servers"] = new_servers
        ch["nowPlayingEn"] = json.dumps(new_servers, ensure_ascii=False)
        def_srv = next((s for s in new_servers if s.get("isDefault")), new_servers[0])
        ch["quality"] = def_srv.get("quality", "HD")
        updated_count += 1

new_code = f"export const DEFAULT_CHANNELS: Dict[] = {json.dumps(channels_data, ensure_ascii=False, indent=2)};"
content = content[:match.start()] + new_code + content[match.end():]
with open(target_file, "w", encoding="utf-8") as f:
    f.write(content)

print(f"Successfully updated {updated_count} channels in catalog-loader.ts!")
