import re
from curl_cffi import requests

session = requests.Session(impersonate="chrome124")
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": "https://cinesrc.st/"
}

chunks = [
    "7d40f1de8ff7c095.js",
    "14c7dc12455c277c.js",
    "f32ba640f0b58282.js",
    "693f69582a5d99f6.js",
    "82833103ff1460c9.js",
    "c49dea1758b0d67e.js",
    "ad01bee8645099b6.js"
]

for c in chunks:
    try:
        r = session.get(f"https://cinesrc.st/_next/static/chunks/{c}", headers=headers)
        text = r.text
        apis = re.findall(r"['\"`](/(?:api|embed|v1|v2|source|stream|ajax|player)[^'\"`\s]*)['\"`]", text)
        urls = re.findall(r"['\"`](https?://[^'\"`\s]+)['\"`]", text)
        if apis or urls:
            print(f"=== Chunk: {c} ===")
            if apis:
                print("  APIs / Paths:")
                for a in set(apis):
                    print("   ", a)
            if urls:
                print("  External URLs:")
                for u in set(urls):
                    if not u.endswith(".js") and not u.endswith(".png") and not u.endswith(".css"):
                        print("   ", u)
    except Exception as e:
        print(f"Error {c}: {e}")
