import re
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
SERIES_FILE = os.path.join(DATA_DIR, 'vod_series.json')

def clean_title(title):
    t = title
    t = re.sub(r'موقع\s+قصة\s+عشق\s+الأصلي', '', t)
    t = re.sub(r'موقع\s+قصة\s+عشق\s+الاصلي', '', t)
    t = re.sub(r'موقع\s+قصة\s+عشق', '', t)
    t = re.sub(r'قصة\s+عشق', '', t)
    t = re.sub(r'3isk\w*', '', t)
    t = re.sub(r'مشاهدة\s+وتحميل', '', t)
    t = re.sub(r'مشاهدة\s+مسلسل', 'مسلسل', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

with open(SERIES_FILE, 'r', encoding='utf-8') as f:
    series = json.load(f)

for s in series:
    s['title'] = clean_title(s['title'])

with open(SERIES_FILE, 'w', encoding='utf-8') as f:
    json.dump(series, f, ensure_ascii=False, indent=2)

print(f"[+] Cleaned {len(series)} series titles from any 3isk/قصة عشق branding.")
