"""Check AlternativeTo submission status"""
import sys, json
from playwright.sync_api import sync_playwright

CHROME = "/opt/data/cache/chromium/chrome-linux/chrome"

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True, executable_path=CHROME,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-crashpad", "--disable-blink-features=AutomationControlled"]
    )
    ctx = browser.new_context(viewport={"width": 1280, "height": 900},
        user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/IP Safari/537.36")
    page = ctx.new_page()
    page.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false})")

    page.goto("https://alternativeto.net/login/", timeout=20000)
    page.wait_for_timeout(3000)
    page.fill("input[placeholder='Email']", "dean@deanware.com")
    page.fill("input[placeholder='Password']", "GNV_uvq.xmk2mwx0dwz")
    page.click("button:has-text('Sign in')")
    page.wait_for_timeout(3000)
    print(f"Logged in: {page.url}")

    # Check my submissions
    page.goto("https://alternativeto.net/my-submissions/", timeout=15000)
    page.wait_for_timeout(3000)
    print(f"Submissions page: {page.url}")

    text = page.inner_text("body")
    print(text[:1500])

    page.screenshot(path="/tmp/altto_status.png")
    print("Screenshot saved to /tmp/altto_status.png")

    browser.close()