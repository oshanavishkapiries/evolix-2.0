"""Fingerprint spoofing scripts and profiles for Playwright stealth mode.

Emulates real browser fingerprint profiles:
- Consistent User-Agent + Client Hints (UACH) + navigator.platform
- WebGL Unmasked Vendor & Renderer spoofing (NVIDIA, Intel, AMD)
- Canvas micro-noise injection to evade canvas fingerprinting
- AudioContext frequency buffer micro-noise injection
- Hardware attributes (hardwareConcurrency, deviceMemory)
- Screen and window dimension alignment
"""

import random

# Real-world consistent hardware and platform profiles
PROFILES = [
    {
        "name": "win11_chrome_nvidia_rtx3060",
        "platform": "Win32",
        "oscpu": "Windows NT 10.0; Win64; x64",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "sec_ch_ua_platform": '"Windows"',
        "sec_ch_ua_platform_version": '"15.0.0"',
        "webgl_vendor": "Google Inc. (NVIDIA)",
        "webgl_renderer": "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
        "cores": 8,
        "memory": 16,
        "viewport": {"width": 1920, "height": 1080},
    },
    {
        "name": "win11_chrome_nvidia_rtx4070",
        "platform": "Win32",
        "oscpu": "Windows NT 10.0; Win64; x64",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "sec_ch_ua_platform": '"Windows"',
        "sec_ch_ua_platform_version": '"15.0.0"',
        "webgl_vendor": "Google Inc. (NVIDIA)",
        "webgl_renderer": "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
        "cores": 16,
        "memory": 32,
        "viewport": {"width": 1920, "height": 1080},
    },
    {
        "name": "win10_chrome_intel_iris",
        "platform": "Win32",
        "oscpu": "Windows NT 10.0; Win64; x64",
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        "sec_ch_ua_platform": '"Windows"',
        "sec_ch_ua_platform_version": '"10.0.0"',
        "webgl_vendor": "Google Inc. (Intel)",
        "webgl_renderer": "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
        "cores": 8,
        "memory": 8,
        "viewport": {"width": 1536, "height": 864},
    },
    {
        "name": "mac_chrome_apple_m2",
        "platform": "MacIntel",
        "oscpu": "Intel Mac OS X 10_15_7",
        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "sec_ch_ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "sec_ch_ua_platform": '"macOS"',
        "sec_ch_ua_platform_version": '"14.5.0"',
        "webgl_vendor": "Apple Inc.",
        "webgl_renderer": "Apple M2",
        "cores": 8,
        "memory": 16,
        "viewport": {"width": 1440, "height": 900},
    },
]


def generate_fingerprint_injection_script(profile: dict) -> str:
    """Returns a client-side JavaScript snippet to inject before any page scripts load."""
    return f"""
    (() => {{
        const profile = {profile};

        // 1. Hardware Concurrency & Device Memory
        try {{
            Object.defineProperty(navigator, 'hardwareConcurrency', {{
                get: () => profile.cores,
                configurable: true
            }});
            Object.defineProperty(navigator, 'deviceMemory', {{
                get: () => profile.memory,
                configurable: true
            }});
        }} catch(e) {{}}

        // 2. Platform & OS consistency
        try {{
            Object.defineProperty(navigator, 'platform', {{
                get: () => profile.platform,
                configurable: true
            }});
        }} catch(e) {{}}

        // 3. UserAgentData (Client Hints) spoofing
        try {{
            if (navigator.userAgentData) {{
                const brands = [
                    {{ brand: 'Google Chrome', version: '131' }},
                    {{ brand: 'Chromium', version: '131' }},
                    {{ brand: 'Not_A Brand', version: '24' }}
                ];
                Object.defineProperty(navigator.userAgentData, 'brands', {{
                    get: () => brands,
                    configurable: true
                }});
                Object.defineProperty(navigator.userAgentData, 'platform', {{
                    get: () => profile.sec_ch_ua_platform.replace(/"/g, ''),
                    configurable: true
                }});
                Object.defineProperty(navigator.userAgentData, 'mobile', {{
                    get: () => false,
                    configurable: true
                }});
                
                const origGetHighEntropyValues = navigator.userAgentData.getHighEntropyValues;
                navigator.userAgentData.getHighEntropyValues = function(hints) {{
                    return new Promise((resolve) => {{
                        origGetHighEntropyValues.call(this, hints).then(res => {{
                            res.platform = profile.sec_ch_ua_platform.replace(/"/g, '');
                            res.platformVersion = profile.sec_ch_ua_platform_version.replace(/"/g, '');
                            res.architecture = 'x86';
                            res.bitness = '64';
                            res.model = '';
                            res.uaFullVersion = '131.0.6778.204';
                            resolve(res);
                        }}).catch(() => {{
                            resolve({{
                                platform: profile.sec_ch_ua_platform.replace(/"/g, ''),
                                platformVersion: profile.sec_ch_ua_platform_version.replace(/"/g, ''),
                                architecture: 'x86',
                                bitness: '64',
                                model: '',
                                uaFullVersion: '131.0.6778.204'
                            }});
                        }});
                    }});
                }};
            }}
        }} catch(e) {{}}

        // 4. WebGL Vendor & Renderer Masking
        const getParameterProxyHandler = (target, thisArg, args) => {{
            const param = args[0];
            // UNMASKED_VENDOR_WEBGL = 0x9245
            if (param === 37445) {{
                return profile.webgl_vendor;
            }}
            // UNMASKED_RENDERER_WEBGL = 0x9246
            if (param === 37446) {{
                return profile.webgl_renderer;
            }}
            return Reflect.apply(target, thisArg, args);
        }};

        try {{
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = new Proxy(getParameter, {{
                apply: getParameterProxyHandler
            }});
        }} catch(e) {{}}

        try {{
            const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = new Proxy(getParameter2, {{
                apply: getParameterProxyHandler
            }});
        }} catch(e) {{}}

        // 5. Canvas Micro-noise injection
        try {{
            const toDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(...args) {{
                const context = this.getContext('2d');
                if (context && this.width > 16 && this.height > 16) {{
                    try {{
                        const imgData = context.getImageData(0, 0, 1, 1);
                        imgData.data[0] = (imgData.data[0] ^ 1);
                        context.putImageData(imgData, 0, 0);
                    }} catch(err) {{}}
                }}
                return toDataURL.apply(this, args);
            }};

            const getImageData = CanvasRenderingContext2D.prototype.getImageData;
            CanvasRenderingContext2D.prototype.getImageData = function(...args) {{
                const imgData = getImageData.apply(this, args);
                if (imgData.data && imgData.data.length > 4) {{
                    imgData.data[0] = (imgData.data[0] ^ 1);
                }}
                return imgData;
            }};
        }} catch(e) {{}}

        // 6. AudioContext Fingerprint Micro-noise
        try {{
            const origGetChannelData = AudioBuffer.prototype.getChannelData;
            AudioBuffer.prototype.getChannelData = function(channel) {{
                const results = origGetChannelData.apply(this, arguments);
                if (results && results.length > 10) {{
                    results[results.length - 1] += 0.0000001;
                }}
                return results;
            }};
        }} catch(e) {{}}

        // 7. Screen & Window Metrics Consistency
        try {{
            Object.defineProperty(window.screen, 'availWidth', {{ get: () => profile.viewport.width }});
            Object.defineProperty(window.screen, 'availHeight', {{ get: () => profile.viewport.height - 40 }});
            Object.defineProperty(window.screen, 'width', {{ get: () => profile.viewport.width }});
            Object.defineProperty(window.screen, 'height', {{ get: () => profile.viewport.height }});
            Object.defineProperty(window.screen, 'colorDepth', {{ get: () => 24 }});
            Object.defineProperty(window.screen, 'pixelDepth', {{ get: () => 24 }});
        }} catch(e) {{}}
    }})();
    """


def get_random_profile() -> dict:
    return random.choice(PROFILES)
