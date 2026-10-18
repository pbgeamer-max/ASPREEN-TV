import urllib.request
import urllib.parse
import ssl
import re
import sys
import json
import time

sys.stdout.reconfigure(encoding='utf-8')
ctx = ssl._create_unverified_context()

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

def get_page(url, headers=None):
    hdrs = {'User-Agent': USER_AGENT}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
        return r.read().decode('utf-8', errors='ignore')

def post_form(url, data_dict, referer=None, origin=None):
    payload = urllib.parse.urlencode(data_dict).encode('utf-8')
    hdrs = {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    if referer:
        hdrs['Referer'] = referer
    if origin:
        hdrs['Origin'] = origin
    req = urllib.request.Request(url, data=payload, headers=hdrs)
    with urllib.request.urlopen(req, timeout=12, context=ctx) as r:
        return r.read().decode('utf-8', errors='ignore')

def unpack_dean_edwards(p, a, c, k, e=None, d=None):
    try:
        def e_func(c_val):
            return ('' if c_val < a else e_func(int(c_val / a))) + (chr(c_val % a + 29) if c_val % a > 35 else '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[c_val % a])
        k_list = k.split('|')
        d_map = {}
        for i in range(c):
            d_map[e_func(i)] = k_list[i] if i < len(k_list) and k_list[i] else e_func(i)
        def repl(m):
            w = m.group(0)
            return d_map.get(w, w)
        return re.sub(r'\b\w+\b', repl, p)
    except Exception:
        return ""

def extract_direct_m3u8(cdn_url):
    """Attempt to extract direct m3u8 from various video hosts"""
    try:
        if 'ukrcdn' in cdn_url:
            cdn_html = get_page(cdn_url, headers={'Referer': 'https://3iskk.xyz/'})
            playback_m = re.findall(r'fetch\([\'"](https:[^"\']+playback\?g=[^"\']+)[\'"]', cdn_html)
            if playback_m:
                playback_api_url = playback_m[0].replace(r'\/', '/')
                pb_json_str = get_page(playback_api_url, headers={
                    'Referer': cdn_url,
                    'Accept': 'application/json'
                })
                pb_data = json.loads(pb_json_str)
                if 'url' in pb_data:
                    return pb_data['url'], 'ukrcdn'

        # Check packed or standard player page (miravd, dood, vidmoly, etc.)
        cdn_html = get_page(cdn_url, headers={'Referer': 'https://3iskk.xyz/'})
        packed_m = re.search(r"eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)", cdn_html, re.DOTALL)
        if packed_m:
            p, a, c, k = packed_m.groups()
            unpacked = unpack_dean_edwards(p, int(a), int(c), k)
            m3u8_list = re.findall(r'https?://[^\s"\'<>]+\.m3u8[^\s"\'<>]*', unpacked)
            if m3u8_list:
                return m3u8_list[0], 'packed_hls'
            file_m = re.findall(r'file\s*:\s*["\'](https?://[^"\']+)["\']', unpacked)
            if file_m:
                return file_m[0], 'packed_file'

        # Direct search in html
        m3u8_list = re.findall(r'https?://[^\s"\'<>]+\.m3u8[^\s"\'<>]*', cdn_html)
        if m3u8_list:
            return m3u8_list[0], 'direct_hls'

    except Exception:
        pass
    return None, None

def resolve_3isk_episode(episode_url):
    """
    Takes a 3isk episode URL and resolves:
    - hls_url: direct master.m3u8
    - embed_url: clean CDN embed URL (safe for iframes, no 3isk popups)
    - cdn_type: e.g. ukrcdn, miravd, etc.
    """
    result = {
        'success': False,
        'episode_url': episode_url,
        'hls_url': None,
        'embed_url': None,
        'raw_embed': None,
        'cdn_type': None,
        'title': None,
        'error': None
    }

    try:
        t0 = time.time()
        # Step 1: fetch episode page
        ep_html = get_page(episode_url)
        title_m = re.findall(r'<h1[^>]*>(.*?)</h1>', ep_html, re.DOTALL)
        if title_m:
            result['title'] = re.sub(r'<[^>]+>', '', title_m[0]).strip()

        form1_action = re.findall(r'<form[^>]*action=["\'](https://aa\.3isk\.icu/[^"\']+)["\']', ep_html)
        news1_val = re.findall(r'<input[^>]*name=["\']news["\'][^>]*value=["\']([^"\']+)["\']', ep_html)
        if not form1_action or not news1_val:
            result['error'] = 'Could not find Step 1 form on episode page'
            return result

        action1 = form1_action[0]
        token1 = news1_val[0]

        # Step 2: Post to aa.3isk.icu step 1
        step1_html = post_form(action1, {'news': token1, 'submit': 'submit'}, referer=episode_url, origin='https://3iskk.xyz')

        # Find step 2 action & token from JS
        action2_m = re.findall(r'var\s+myUrl\s*=\s*["\']([^"\']+)["\']', step1_html)
        token2_m = re.findall(r'myInput\.value\s*=\s*["\']([^"\']+)["\']', step1_html)
        if not action2_m:
            action2_m = re.findall(r"action\s*=\s*['\"](https://aa\.3isk\.icu/[^'\"]+)['\"]", step1_html)
        if not token2_m:
            token2_m = re.findall(r'name=["\']news["\'][^>]*value=["\']([^"\']+)["\']', step1_html)

        if not action2_m or not token2_m or not token2_m[0]:
            player_html = step1_html
        else:
            action2 = action2_m[0]
            token2 = token2_m[0]
            player_html = post_form(action2, {'news': token2, 'submit': 'submit'}, referer=action1, origin='https://aa.3isk.icu')

        # Step 3: Extract 3isk embed URL
        embed_m = re.findall(r'<iframe[^>]*src=["\'](https://3iskk\.xyz/embed/[^"\']+)["\']', player_html)
        if not embed_m:
            any_iframe = re.findall(r'<iframe[^>]*src=["\']([^"\']+)["\']', player_html)
            if any_iframe:
                result['embed_url'] = any_iframe[0]
                result['success'] = True
                return result
            result['error'] = 'Could not find player embed iframe'
            return result

        isk_embed_url = embed_m[0]
        result['raw_embed'] = isk_embed_url

        # Step 4: Fetch 3isk embed page
        isk_embed_html = get_page(isk_embed_url, headers={'Referer': 'https://aa.3isk.icu/'})

        cdn_iframes = re.findall(r'<iframe[^>]*src=["\']([^"\']+)["\']', isk_embed_html)
        if not cdn_iframes:
            result['embed_url'] = isk_embed_url
            result['success'] = True
            return result

        cdn_url = cdn_iframes[0]
        result['embed_url'] = cdn_url

        # Step 5: Extract direct HLS / mp4 stream
        hls_url, cdn_type = extract_direct_m3u8(cdn_url)
        if hls_url:
            result['hls_url'] = hls_url
            result['cdn_type'] = cdn_type

        result['success'] = True
        result['duration_sec'] = round(time.time() - t0, 2)
        return result

    except Exception as e:
        result['error'] = str(e)
        return result

if __name__ == '__main__':
    test_urls = [
        'https://3iskk.xyz/watch/episodes/serie-teskilat-season-1-episode-189/',
        'https://3iskk.xyz/watch/episodes/serie-sifir-bir-season-6-episode-6/',
        'https://3iskk.xyz/watch/episodes/serie-alti-ustu-istanbul-season-1-episode-17/'
    ]
    for u in test_urls:
        print(f"\n--- Testing: {u} ---")
        res = resolve_3isk_episode(u)
        print(json.dumps(res, ensure_ascii=False, indent=2))
