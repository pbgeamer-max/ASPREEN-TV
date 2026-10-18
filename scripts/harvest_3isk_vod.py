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
CACHE_DIR = os.path.join(DATA_DIR, 'vod_cache')
os.makedirs(CACHE_DIR, exist_ok=True)

def fetch_url(url, timeout=12):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read().decode('utf-8', errors='ignore')

def parse_card_box(box, item_type='series'):
    link_m = re.search(r'<a\s+href=["\']([^"\']+)["\']\s+title=["\']([^"\']+)["\']', box)
    if not link_m:
        return None
    href, title = link_m.groups()
    img_m = re.search(r'data-image=["\']([^"\']+)["\']', box)
    img = img_m.group(1) if img_m else None
    slug = href.strip('/').split('/')[-1]
    
    clean_title = title.strip()
    is_dubbed = 'مدبلج' in clean_title
    is_subbed = 'مترجم' in clean_title

    return {
        'id': slug,
        'slug': slug,
        'title': clean_title,
        'url': href,
        'posterUrl': img,
        'type': item_type,
        'isDubbed': is_dubbed,
        'isSubbed': is_subbed
    }

def fetch_series_page(page_num):
    url = f'https://3iskk.xyz/w-srs/page/{page_num}/' if page_num > 1 else 'https://3iskk.xyz/w-srs/'
    try:
        html = fetch_url(url)
        boxes = re.findall(r'<li class="type_item_box">(.*?)</li>', html, re.DOTALL)
        items = []
        for box in boxes:
            card = parse_card_box(box, item_type='series')
            if card:
                items.append(card)
        return items
    except Exception as e:
        print(f"Error fetching series page {page_num}: {e}")
        return []

def fetch_movie_page(page_num):
    url = f'https://3iskk.xyz/movies/page/{page_num}/' if page_num > 1 else 'https://3iskk.xyz/movies/'
    try:
        html = fetch_url(url)
        boxes = re.findall(r'<li class="type_item_box">(.*?)</li>', html, re.DOTALL)
        items = []
        for box in boxes:
            card = parse_card_box(box, item_type='movie')
            if card:
                items.append(card)
        return items
    except Exception as e:
        print(f"Error fetching movie page {page_num}: {e}")
        return []

def harvest_series(max_pages=44, max_workers=8):
    print(f"[*] Harvesting Turkish series across {max_pages} pages...")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        results = list(ex.map(fetch_series_page, range(1, max_pages + 1)))
    
    seen = set()
    all_series = []
    for res in results:
        for s in res:
            if s['id'] not in seen:
                seen.add(s['id'])
                all_series.append(s)
    
    out_path = os.path.join(DATA_DIR, 'vod_series.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(all_series, f, ensure_ascii=False, indent=2)
    
    elapsed = round(time.time() - t0, 2)
    print(f"[+] Harvested {len(all_series)} series in {elapsed}s -> {out_path}")
    return all_series

def harvest_movies(max_pages=16, max_workers=6):
    print(f"[*] Harvesting Turkish movies across {max_pages} pages...")
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        results = list(ex.map(fetch_movie_page, range(1, max_pages + 1)))
    
    seen = set()
    all_movies = []
    for res in results:
        for m in res:
            if m['id'] not in seen:
                seen.add(m['id'])
                all_movies.append(m)
    
    out_path = os.path.join(DATA_DIR, 'vod_movies.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(all_movies, f, ensure_ascii=False, indent=2)
    
    elapsed = round(time.time() - t0, 2)
    print(f"[+] Harvested {len(all_movies)} movies in {elapsed}s -> {out_path}")
    return all_movies

def get_series_detail(series_slug_or_url):
    """
    Returns full seasons and episodes list for a series, with disk caching.
    """
    if series_slug_or_url.startswith('http'):
        slug = series_slug_or_url.strip('/').split('/')[-1]
        url = series_slug_or_url
    else:
        slug = series_slug_or_url
        url = f"https://3iskk.xyz/watch/tvshows/{slug}/"
    
    cache_file = os.path.join(CACHE_DIR, f"series_{slug}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cached = json.load(f)
                if cached.get('seasons'):
                    return cached
        except Exception:
            pass
    
    # Fetch from 3isk
    html = fetch_url(url)
    
    title_m = re.findall(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL)
    title = re.sub(r'<[^>]+>', '', title_m[0]).strip() if title_m else slug
    
    poster_m = re.findall(r'<div class="poster"[^>]*>.*?<img[^>]*src=["\']([^"\']+)["\']', html, re.DOTALL)
    poster = poster_m[0] if poster_m else ""
    
    story_m = re.findall(r'<div[^>]*class=["\']wp-content["\'][^>]*>(.*?)</div>', html, re.DOTALL)
    if not story_m:
        story_m = re.findall(r'<div[^>]*class=["\']story["\'][^>]*>(.*?)</div>', html, re.DOTALL)
    story = re.sub(r'<[^>]+>', '', story_m[0]).strip() if story_m else ""

    # Parse episode links
    raw_episodes = re.findall(r'href=["\'](https://3iskk\.xyz/watch/episodes/[^"\']+)["\']', html)
    
    seasons = {}
    for ep_href in set(raw_episodes):
        ep_slug = ep_href.strip('/').split('/')[-1]
        
        s_num = 1
        e_num = 1
        s_match = re.search(r'season-(\d+)', ep_slug)
        if s_match:
            s_num = int(s_match.group(1))
        e_match = re.search(r'episode-(\d+)', ep_slug)
        if e_match:
            e_num = int(e_match.group(1))
        
        if s_num not in seasons:
            seasons[s_num] = []
        
        ep_title = f"الحلقة {e_num}"
        if not any(e['id'] == ep_slug for e in seasons[s_num]):
            seasons[s_num].append({
                'id': ep_slug,
                'seasonNumber': s_num,
                'episodeNumber': e_num,
                'title': ep_title,
                'url': ep_href
            })

    sorted_seasons = []
    for s_num in sorted(seasons.keys()):
        eps = sorted(seasons[s_num], key=lambda x: x['episodeNumber'])
        sorted_seasons.append({
            'seasonNumber': s_num,
            'episodesCount': len(eps),
            'episodes': eps
        })

    data = {
        'id': slug,
        'slug': slug,
        'title': title,
        'url': url,
        'posterUrl': poster,
        'overview': story,
        'seasonsCount': len(sorted_seasons),
        'totalEpisodes': sum(s['episodesCount'] for s in sorted_seasons),
        'seasons': sorted_seasons,
        'updatedAt': int(time.time())
    }

    # Save cache
    try:
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Warning: could not write cache {cache_file}: {e}")

    return data

if __name__ == '__main__':
    args = sys.argv[1:]
    if '--test' in args:
        print("--- Running Test Harvest (3 series pages, 2 movie pages) ---")
        harvest_series(max_pages=3)
        harvest_movies(max_pages=2)
        print("Testing series detail for 'serie-sifir-bir'...")
        det = get_series_detail('serie-sifir-bir')
        print(f"Title: {det['title']}, Seasons: {det['seasonsCount']}, Total Eps: {det['totalEpisodes']}")
    elif '--movies' in args:
        harvest_movies(max_pages=16)
    elif '--series' in args:
        harvest_series(max_pages=44)
    else:
        # Full harvest of all Turkish series & movies
        print("=== Full Catalog Harvest from 3iskk.xyz ===")
        harvest_series(max_pages=44)
        harvest_movies(max_pages=16)
