import urllib.request
import ssl
import re
import sys
import json
import time
import os
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding='utf-8')
ctx = ssl._create_unverified_context()
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
SERIES_FILE = os.path.join(DATA_DIR, 'vod_series.json')

def clean_overview(text):
    if not text:
        return ""
    t = re.sub(r'<[^>]+>', ' ', text)
    t = re.sub(r'موقع\s*قصة\s*عشق(?:\s*الاصلي|\s*الأصلي)?', '', t, flags=re.IGNORECASE)
    t = re.sub(r'قصة\s*عشق', '', t, flags=re.IGNORECASE)
    t = re.sub(r'3isk(?:\.xyz|\.vip|\.video)?', '', t, flags=re.IGNORECASE)
    t = re.sub(r'مشاهدة\s*وتحميل\s*حصري[ااً]\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'مشاهدة\s*وتحميل\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'مشاهدة\s*حصري[ااً]\s*(?:علي|على)?\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'بجودة\s*عالية\s*(?:HD|720p|1080p|4k)?', '', t, flags=re.IGNORECASE)
    t = re.sub(r'كامل\s*مترجم\s*', ' ', t, flags=re.IGNORECASE)
    t = re.sub(r'كامل\s*مدبلج\s*', ' ', t, flags=re.IGNORECASE)
    t = re.sub(r'اون\s*لاين\s*', '', t, flags=re.IGNORECASE)

    t = re.sub(r'\s+', ' ', t).strip()

    if '.' in t:
        parts = t.split('.', 1)
        if any(w in parts[0] for w in ['مسلسل', 'فيلم', 'الدراما', 'مترجم', 'مدبلج']) and len(parts[1].strip()) > 20:
            t = parts[1].strip()

    story_start = re.search(r'(يروي|تدور\s*أحداث|تدور\s*احداث|في\s*إطار|في\s*اطار|حول\s+|قصة\s+|تبدأ\s+|يحكي|تنقلب|تُطلق|تطلق|حين\s+|عندما\s+)', t)
    if story_start and story_start.start() < 60:
        t = t[story_start.start():]

    t = re.sub(r'\s+', ' ', t).strip()
    return t

def fetch_overview(item):
    if item.get('overview') and len(item['overview']) > 15:
        return item
    url = item.get('url')
    if not url:
        return item
    try:
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=8, context=ctx) as r:
            html = r.read().decode('utf-8', errors='ignore')
            p_matches = re.findall(r'<p[^>]*>(.*?)</p>', html, re.DOTALL)
            raw = " ".join([p for p in p_matches if len(p.strip()) > 20])
            item['overview'] = clean_overview(raw)
    except Exception as e:
        item['overview'] = item.get('overview', '')
    return item

def main():
    print("--- Enriching Series with Clean Overviews (Zero 3isk Branding) ---")
    with open(SERIES_FILE, 'r', encoding='utf-8') as f:
        series_list = json.load(f)

    total = len(series_list)
    print(f"Total series to enrich: {total}")

    completed = 0
    with ThreadPoolExecutor(max_workers=30) as executor:
        results = list(executor.map(fetch_overview, series_list))

    with open(SERIES_FILE, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    with_overview = sum(1 for s in results if s.get('overview') and len(s['overview']) > 10)
    print(f"Enrichment completed! {with_overview}/{total} series have clean overviews.")

if __name__ == '__main__':
    main()
