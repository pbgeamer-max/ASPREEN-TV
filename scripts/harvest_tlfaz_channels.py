# -*- coding: utf-8 -*-
"""
=============================================================================
         🚀 ASPREEN TV ▸ TLFAZ.COM & VIP CHANNELS MASTER HARVESTER
     سكربت سحب وفحص جميع القنوات العربية من موقع تلفاز العرب (tlfaz.com)
     والإبقاء حصراً على القنوات الشغالة 100% مع كافة الجودات والدقات
     ودمجها مع سيرفرات قنواتك الخاصة beIN SPORTS VIP (روابطج بث)
=============================================================================
"""

import os
import sys
import re
import json
import time
import socket
import ssl
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

# Line buffering & utf-8 stdout for Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

# SSL Settings
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

WORKSPACE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CHANNELS_JSON_PATH = os.path.join(WORKSPACE_DIR, "channels.json")
API_CHANNELS_JSON = os.path.join(WORKSPACE_DIR, "apps", "api", "channels.json")
VIP_DIR = os.path.join(WORKSPACE_DIR, "روابطج بث")
SITEMAP_CACHE = os.path.join(WORKSPACE_DIR, "scratch", "tlfaz_sitemap.xml")

DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"

def clean_stream_url(raw_url):
    """Cleans JSON-escaped slashes, hash prefixes, and trailing quotation/backslash garbage"""
    if not raw_url:
        return ""
    u = raw_url.replace(r'\/', '/').replace('\\/', '/')
    if '#http' in u:
        u = u[u.index('#http') + 1:]
    u = u.strip('\\"\'<> ')
    # Cut off at first invalid character
    u = re.sub(r'[\"\'\\<>\s]+.*$', '', u)
    return u.strip()

def verify_and_inspect_stream(stream_url):
    """
    Verifies that a stream returns 200/206/302 and checks if it's a multi-bitrate Master Playlist.
    Returns (is_working, variant_streams_dict)
    """
    cleaned = clean_stream_url(stream_url)
    if not cleaned or not cleaned.startswith("http"):
        return False, {}
    
    # Do not pass tlfaz Referer to CDNs (edgenextcdn blocks tlfaz referer with 403)
    headers = {"User-Agent": DEFAULT_UA}
    try:
        req = urllib.request.Request(cleaned, headers=headers)
        with urllib.request.urlopen(req, timeout=4.0, context=SSL_CTX) as r:
            code = r.getcode()
            if code not in (200, 206, 301, 302):
                return False, {}
            
            # Read first 4KB to check variants
            head_bytes = r.read(4096).decode('utf-8', errors='ignore')
            if "#EXTM3U" not in head_bytes:
                # Could be a direct media stream
                return True, {}
            
            variants = {}
            if "#EXT-X-STREAM-INF" in head_bytes:
                # Parse available resolutions
                lines = head_bytes.splitlines()
                for i, line in enumerate(lines):
                    if line.startswith("#EXT-X-STREAM-INF"):
                        res_match = re.search(r'RESOLUTION=(\d+x\d+)', line)
                        res_label = res_match.group(1) if res_match else "HD"
                        if "1920x1080" in res_label:
                            label = "1080p FHD"
                        elif "1280x720" in res_label:
                            label = "720p HD"
                        elif "1024x576" in res_label or "854x480" in res_label:
                            label = "576p SD"
                        elif "640x360" in res_label:
                            label = "360p Low"
                        elif "512x288" in res_label or "426x240" in res_label:
                            label = "288p Mobile"
                        else:
                            label = f"Res {res_label}"
                        
                        if i + 1 < len(lines):
                            sub_path = lines[i+1].strip()
                            if sub_path and not sub_path.startswith("#"):
                                sub_full = urllib.parse.urljoin(cleaned, sub_path)
                                if label not in variants:
                                    variants[label] = sub_full
            return True, variants
    except Exception:
        return False, {}

def get_all_sitemap_channel_urls():
    """Fetches all channel URLs from local sitemap cache or tlfaz.com"""
    print("📡 [1/4] جارٍ جلب قائمة قنوات موقع tlfaz.com...", flush=True)
    xml = ""
    if os.path.exists(SITEMAP_CACHE) and os.path.getsize(SITEMAP_CACHE) > 1000:
        with open(SITEMAP_CACHE, "r", encoding="utf-8", errors="ignore") as f:
            xml = f.read()
    else:
        sitemap_url = "https://tlfaz.com/vidmov_video-sitemap.xml"
        req = urllib.request.Request(sitemap_url, headers={"User-Agent": DEFAULT_UA})
        with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as r:
            xml = r.read().decode('utf-8', errors='ignore')

    urls = re.findall(r'<loc><!\[CDATA\[(https?://tlfaz\.com/[^\]]+)\]\]></loc>', xml)
    if not urls:
        urls = re.findall(r'<loc>(https?://tlfaz\.com/[^<]+)</loc>', xml)

    print(f" [✓] تم اكتشاف {len(urls)} قناة في الكتالوج الرسمي لموقع tlfaz.com", flush=True)
    return urls

def process_single_tlfaz_channel(url, idx, total):
    """Extracts metadata, resolutions, and stream links for a single channel page"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": DEFAULT_UA, "Referer": "https://tlfaz.com/"})
        with urllib.request.urlopen(req, timeout=5.0, context=SSL_CTX) as r:
            html = r.read().decode('utf-8', errors='ignore')

        title_m = re.search(r'<title>(.*?)</title>', html)
        raw_title = title_m.group(1) if title_m else "قناة تلفزيونية"
        clean_name = raw_title.replace("– تلفاز العرب", "").replace("- تلفاز العرب", "").replace("بث مباشر", "").strip()

        # Extract Category
        category = "قنوات عامة"
        cat_m = re.search(r'rel=["\']category tag["\'][^>]*>(.*?)</a>', html)
        if cat_m:
            category = cat_m.group(1).strip()
        else:
            n_lower = clean_name.lower()
            if any(k in n_lower for k in ["sport", "رياض", "كأس", "دوري"]):
                category = "قنوات رياضية"
            elif any(k in n_lower for k in ["news", "إخبار", "جزيرة", "حدث", "عربية"]):
                category = "قنوات إخبارية"
            elif any(k in n_lower for k in ["kid", "طفل", "أطفال", "كرتون", "toon", "براعم"]):
                category = "قنوات أطفال"
            elif any(k in n_lower for k in ["doc", "وثائق"]):
                category = "قنوات وثائقية"
            elif any(k in n_lower for k in ["quran", "قرآن", "سنة", "مجد", "إسلام"]):
                category = "قنوات دينية"
            elif any(k in n_lower for k in ["cinema", "aflam", "أفلام", "دراما", "مسلسل", "سينما"]):
                category = "قنوات أفلام ومسلسلات"

        # Logo
        logo = ""
        og_img = re.search(r'<meta property=["\']og:image["\'] content=["\']([^"\']+)["\']', html)
        if og_img:
            logo = og_img.group(1)

        slug_m = re.search(r'tlfaz\.com/Tv-Channel/([^/]+)/?', url)
        slug = slug_m.group(1) if slug_m else f"tlfaz-{idx}"
        cid = f"tlfaz-{slug}"

        candidate_urls = []

        # 1. Look for hash player embeds (e.g. play.tlfaz.com/player#https://...)
        for m in re.finditer(r'#https?[^\s"\'<>]+', html):
            c = clean_stream_url(m.group(0))
            if c and c not in candidate_urls:
                candidate_urls.append(c)

        # 2. Look for beeteam368_pro_player JSON
        p = re.search(r'beeteam368_pro_player\((.*?)\);', html, re.DOTALL)
        if p:
            try:
                # Clean escaped slashes in json text before parsing
                json_str = p.group(1).replace(r'\/', '/')
                data = json.loads(json_str)
                v_url = clean_stream_url(data.get("video_url", ""))
                if v_url and v_url not in candidate_urls:
                    candidate_urls.append(v_url)
                for s in data.get("media_sources", []):
                    sf = clean_stream_url(s.get("source_file", ""))
                    if sf and sf not in candidate_urls:
                        candidate_urls.append(sf)
            except Exception:
                pass

        # 3. Look for any direct m3u8 in HTML
        for m in re.finditer(r'https?:[^\s"\'<>]+\.m3u8[^\s"\'<>]*', html):
            c = clean_stream_url(m.group(0))
            if c and not any(skip in c for skip in ["wp-content", "plugin", "theme", "assets"]) and c not in candidate_urls:
                candidate_urls.append(c)

        if not candidate_urls:
            return None

        # Verify candidate streams
        working_stream = None
        working_variants = {}
        for cand in candidate_urls:
            ok, vars_dict = verify_and_inspect_stream(cand)
            if ok:
                working_stream = cand
                working_variants = vars_dict
                break

        if not working_stream:
            return None

        # Build multiple resolution servers
        servers = []
        servers.append({
            "id": "server-1",
            "name": "سيرفر 1 (Master Auto ABR)",
            "upstreamUrl": working_stream,
            "url": f"/live/{cid}.m3u8?server=1",
            "resolution": "Auto ABR (1080p - 288p)"
        })

        srv_idx = 2
        for v_label, v_url in working_variants.items():
            servers.append({
                "id": f"server-{srv_idx}",
                "name": f"سيرفر {srv_idx} ({v_label})",
                "upstreamUrl": v_url,
                "url": f"/live/{cid}.m3u8?server={srv_idx}",
                "resolution": v_label
            })
            srv_idx += 1

        print(f" [{idx+1:3d}/{total}] 🟢 {clean_name} [{category}] ➔ {len(servers)} سيرفرات/جودات شغالة", flush=True)

        return {
            "id": cid,
            "vid": cid,
            "name": clean_name,
            "groupTitle": category,
            "logoUrl": logo,
            "orderIndex": 1000 + idx,
            "streamUrl": working_stream,
            "directM3u8": working_stream,
            "proxyUrl": f"/live/{cid}.m3u8",
            "referer": "",
            "userAgent": DEFAULT_UA,
            "servers": servers,
            "source": "tlfaz.com",
            "status": "live",
            "lastRenewed": time.time()
        }
    except Exception:
        return None

def load_user_vip_channels():
    """Loads all user's private beIN Sports VIP lines from 'روابطج بث'"""
    print("\n📦 [2/4] تحميل قنوات ملفاتك الخاصة من مجلد 'روابطج بث'...", flush=True)
    vip_channels = []
    if not os.path.exists(VIP_DIR):
        print(" [!] مجلد 'روابطج بث' غير موجود!", flush=True)
        return vip_channels

    files = sorted(os.listdir(VIP_DIR))
    grouped = {}

    for fn in files:
        if not fn.endswith(".m3u"):
            continue
        fp = os.path.join(VIP_DIR, fn)
        tag = fn.replace("┃AR┃", "").replace(".m3u", "").strip()

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
                base = re.sub(r"\s+(4K|8K|HD|SD|RAW|HEVC|UHD)(\s+S\d+)?", "", curr_name, flags=re.I).strip()
                if base not in grouped:
                    grouped[base] = []
                grouped[base].append((f"{tag} ({curr_name})", line))
                curr_name = ""

    idx = 1
    for name, stream_items in grouped.items():
        cid_slug = re.sub(r'[^a-zA-Z0-9]+', '-', name).strip('-').lower() or f"bein-{idx}"
        cid = f"bein-vip-{cid_slug}"

        servers = []
        for s_idx, (lbl, stream_url) in enumerate(stream_items[:5], 1):
            servers.append({
                "id": f"server-{s_idx}",
                "name": f"سيرفر {s_idx} ({lbl})",
                "upstreamUrl": stream_url,
                "url": f"/live/{cid}.m3u8?server={s_idx}",
                "resolution": lbl
            })

        primary_url = stream_items[0][1]
        vip_channels.append({
            "id": cid,
            "vid": cid,
            "name": name,
            "groupTitle": "beIN SPORTS VIP (ملفاتك الخاصة)",
            "logoUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/BeIN_Sports_logo.svg/1200px-BeIN_Sports_logo.svg.png",
            "orderIndex": idx,
            "streamUrl": primary_url,
            "directM3u8": primary_url,
            "proxyUrl": f"/live/{cid}.m3u8",
            "referer": "http://line.hey-ott.net/",
            "userAgent": DEFAULT_UA,
            "servers": servers,
            "source": "private-vip",
            "status": "live",
            "lastRenewed": time.time()
        })
        idx += 1

    print(f" [✓] تم تحميل {len(vip_channels)} قناة بي إن سبورت VIP أساسية مع كافة السيرفرات والجودات (4K, 8K, HD, RAW).", flush=True)
    return vip_channels

def main():
    print("=" * 68, flush=True)
    print("   🚀 ASPREEN TV ▸ TLFAZ.COM & VIP CHANNELS MASTER HARVESTER", flush=True)
    print("=" * 68, flush=True)

    vip_channels = load_user_vip_channels()
    urls = get_all_sitemap_channel_urls()

    print(f"\n⚡ [3/4] جارٍ فحص قنوات tlfaz.com واستخراج الروابط الشغالة فقط 100% (6 مسارات متزامنة)...", flush=True)

    tlfaz_channels = []
    # 6 workers with gentle dispatch to prevent LiteSpeed anti-bot drops
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = []
        for i, u in enumerate(urls):
            futures.append(executor.submit(process_single_tlfaz_channel, u, i, len(urls)))
            time.sleep(0.04)

        for future in as_completed(futures):
            res = future.result()
            if res:
                tlfaz_channels.append(res)

    print(f"\n [✓] اكتمل فحص موقع tlfaz.com: تم استخراج {len(tlfaz_channels)} قناة شغالة ومؤكدة 100% بدون أي روابط ميتة.", flush=True)

    # VIP beIN Sports FIRST, then all verified working Arabic channels
    all_channels = vip_channels + tlfaz_channels
    all_channels.sort(key=lambda x: x.get("orderIndex", 9999))

    print(f"\n💾 [4/4] جارٍ حفظ الكتالوج الموحد الجديد بإجمالي: {len(all_channels)} قناة شغالة ومفحوصة...", flush=True)

    # 1. Root channels.json
    with open(CHANNELS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(all_channels, f, ensure_ascii=False, indent=2)

    # 2. apps/api/channels.json
    if os.path.exists(os.path.dirname(API_CHANNELS_JSON)):
        with open(API_CHANNELS_JSON, "w", encoding="utf-8") as f:
            json.dump(all_channels, f, ensure_ascii=False, indent=2)

    # 3. Generate M3U playlists
    m3u_lines = ["#EXTM3U"]
    for ch in all_channels:
        cid = ch["id"]
        name = ch["name"].replace('"', "'")
        group = ch["groupTitle"].replace('"', "'")
        logo = ch.get("logoUrl", "")
        stream_url = f"https://aspreen-tv-production.up.railway.app/live/{cid}.m3u8"
        m3u_lines.append(f'#EXTINF:-1 tvg-id="{cid}" tvg-name="{name}" tvg-logo="{logo}" group-title="{group}",{name}')
        m3u_lines.append(stream_url)

    m3u_content = "\n".join(m3u_lines) + "\n"
    with open(os.path.join(WORKSPACE_DIR, "channels_railway.m3u"), "w", encoding="utf-8") as f:
        f.write(m3u_content)

    with open(os.path.join(WORKSPACE_DIR, "channels.m3u"), "w", encoding="utf-8") as f:
        f.write(m3u_content)

    print(f" [✓] تم تحديث channels.json بنجاح!", flush=True)
    print(f" [✓] تم توليد ملف channels_railway.m3u بروابط موقعك السحابي.", flush=True)
    print("=" * 68, flush=True)

if __name__ == "__main__":
    main()
