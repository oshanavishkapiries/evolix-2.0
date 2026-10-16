import json
from urllib.parse import urlparse

with open("tools/evo-engine/test/cinesrc_requests.json") as f:
    requests = json.load(f)

with open("tools/evo-engine/test/cinesrc_responses.json") as f:
    responses = json.load(f)

resp_map = {r["url"]: r for r in responses}

print(f"Total Requests: {len(requests)}")
print("=" * 60)

for i, req in enumerate(requests):
    url = req["url"]
    parsed = urlparse(url)
    method = req["method"]
    headers = req["headers"]
    post_data = req.get("post_data")

    # Filter out static chunks, css, analytics to see key requests
    if any(ext in parsed.path for ext in [".css", ".png", ".jpg", ".svg", ".ico", "font"]):
        continue

    resp = resp_map.get(url, {})
    status = resp.get("status", "???")
    body_preview = resp.get("body_preview", "")
    
    print(f"[{i+1}] {method} {parsed.netloc}{parsed.path} (Status: {status})")
    if parsed.query:
        print(f"    Query: {parsed.query}")
    if "next-action" in headers:
        print(f"    Next-Action: {headers['next-action']}")
    if "x-cs-q" in headers or "x-cs-r" in headers:
        print(f"    CS-Headers: q={headers.get('x-cs-q')} r={headers.get('x-cs-r')[:20] if headers.get('x-cs-r') else ''} p={headers.get('x-cs-p')[:20] if headers.get('x-cs-p') else ''}")
    if post_data:
        print(f"    Post Data: {post_data[:200]}")
    if body_preview:
        print(f"    Response: {body_preview[:200].strip()}")
    print("-" * 50)
