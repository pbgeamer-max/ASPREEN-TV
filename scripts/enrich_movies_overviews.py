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

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
MOVIES_FILE = os.path.join(DATA_DIR, 'vod_movies.json')

def clean_title(title):
    t = title
    t = re.sub(r'موقع\s+قصة\s+عشق\s+الأصلي', '', t)
    t = re.sub(r'موقع\s+قصة\s+عشق\s+الاصلي', '', t)
    t = re.sub(r'موقع\s+قصة\s+عشق', '', t)
    t = re.sub(r'قصة\s+عشق', '', t)
    t = re.sub(r'3isk\w*', '', t)
    t = re.sub(r'مشاهدة\s+وتحميل', '', t)
    t = re.sub(r'مشاهدة\s+فيلم', 'فيلم', t)
    t = re.sub(r'مشاهدة\s+مسلسل', 'مسلسل', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def clean_overview(text):
    if not text:
        return ""
    lines = text.splitlines()
    cleaned = []
    for l in lines:
        if 'قصة عشق' in l or '3isk' in l or 'مشاهدة وتحميل' in l:
            l = re.sub(r'[^.!\n]*(?:قصة\s+عشق|3isk|مشاهدة\s+وتحميل)[^.!\n]*[.!\n]?', '', l)
        l = re.sub(r'\s+', ' ', l).strip()
        if l and len(l) > 10:
            cleaned.append(l)
    return ' '.join(cleaned)

def fetch_movie_info(movie):
    url = movie['url']
    try:
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            html = r.read().decode('utf-8', errors='ignore')
        
        paragraphs = re.findall(r'<p[^>]*>(.*?)</p>', html, re.DOTALL)
        full_text = ' '.join(re.sub(r'<[^>]+>', '', p) for p in paragraphs)
        overview = clean_overview(full_text)
        
        movie['title'] = clean_title(movie['title'])
        movie['overview'] = overview
        return movie
    except Exception as e:
        movie['title'] = clean_title(movie['title'])
        movie['overview'] = movie.get('overview', '')
        return movie

def main():
    if not os.path.exists(MOVIES_FILE):
        print("Movies file not found:", MOVIES_FILE)
        return
    
    with open(MOVIES_FILE, 'r', encoding='utf-8') as f:
        movies = json.load(f)
    
    print(f"[*] Enriching {len(movies)} movies with descriptions and clean titles...")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=20) as ex:
        enriched = list(ex.map(fetch_movie_info, movies))
    
    with open(MOVIES_FILE, 'w', encoding='utf-8') as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)
    
    with_overview = sum(1 for m in enriched if m.get('overview'))
    print(f"[+] Done in {round(time.time() - t0, 2)}s! Movies with overview: {with_overview}/{len(enriched)}")

if __name__ == '__main__':
    main()
