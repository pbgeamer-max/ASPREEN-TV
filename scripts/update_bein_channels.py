import json

verified_bein = {
    "beIN Sports 1": "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tn8crh/qt4ed8SWjg2VAPpQXaBt6A0EAO5/xui/assets/79768337/22315546/1316.css",
    "beIN Sports 2": "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tn8czx/FwHcJ0qLJKiPSL3n5saQbZ5O0dV/xui/assets/79768337/22315546/1325.css",
    "beIN Sports 3": "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tn8d8e/U52wsr5Z7YXgpTRXh2hNaEhBOhF/xui/assets/79768337/22315546/1334.css",
    "beIN Sports 4": "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tn8dbe/Jm-cPkf0r2DymPtCt19TzIYhr6_/xui/assets/79768337/22315546/1343.css",
    "beIN Sports 5": "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tn8dem/6Y6pzfQ7kUG2nT6OJT3rB2hTyUu/xui/assets/79768337/22315546/1571.css",
    "beIN Sports 6": "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tn8dhy/TfPuNnVh293psIyRim3ko433dgj/xui/assets/79768337/22315546/1364.css",
    "beIN Sports 7": "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tn8e5u/OV5ExQ9OCYPdEmT_pFhkaH304KG/xui/assets/79768337/22315546/1370.css",
    "beIN Sports 8": "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tn8e93/Bz0QzBGjz1jLSnDr6fjbfDruApf/xui/assets/79768337/22315546/1382.css",
    "beIN Sports 9": "https://still-dust-c9ae.manon-lol2000.workers.dev/t/tn8edn/BMfklpMw3I7k8TaVvscyRC9Qcz-/xui/assets/79768337/22315546/1391.css"
}

with open("data/oscar_channels_live.json", "r", encoding="utf-8") as f:
    channels = json.load(f)

for name, url in verified_bein.items():
    channels[name] = {
        "name": name,
        "streamUrl": url,
        "ua": "OSCARTV2021"
    }

with open("data/oscar_channels_live.json", "w", encoding="utf-8") as f:
    json.dump(channels, f, ensure_ascii=False, indent=2)

print(f"Updated data/oscar_channels_live.json with {len(channels)} channels.")

# Generate m3u8
m3u_lines = ["#EXTM3U"]
for name, data in channels.items():
    group = "Sports" if any(k in name.lower() for k in ["sport", "bein", "كأس", "أون", "رياض"]) else "General"
    m3u_lines.append(f'#EXTINF:-1 tvg-name="{name}" group-title="{group}",{name}')
    m3u_lines.append(data["streamUrl"])

with open("data/oscar_channels.m3u8", "w", encoding="utf-8") as f:
    f.write("\n".join(m3u_lines) + "\n")

print("Generated data/oscar_channels.m3u8 successfully.")
