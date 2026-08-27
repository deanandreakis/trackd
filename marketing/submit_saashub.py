"""Login to SaaSHub and submit Trackd"""
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/data/cache/chromium/chrome-linux/chrome"
BLURB = "Trackd is a privacy-first Chrome extension that discovers all your subscriptions from Gmail receipts — no bank login, no Plaid, no cloud account. Free tier tracks 10 subscriptions with monthly scans; Pro ($3.99/mo) adds unlimited tracking, weekly scans, CSV export, and cancellation guides."

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True, executable_path=CHROME,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-crashpad", "--disable-blink-features=AutomationControlled"]
    )
    ctx = browser.new_context(viewport={"width": 1280, "height": 900},
        user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/IP Safari/537.36")
    page = ctx.new_page()
    page.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false})")

    # Login
    page.goto("https://www.saashub.com/login", timeout=20000)
    page.wait_for_timeout(3000)
    page.fill("input[name='user[email]']", "dean@deanware.com")
    page.fill("input[name='user[password]']", "xjw8afz.KQP!edb9vqj")
    page.click("input[name='commit']")
    page.wait_for_timeout(5000)
    print(f"After login: {page.url}")

    if "login" in page.url.lower():
        print("Login didn't redirect. Checking page...")
        text = page.inner_text("body")[:500]
        print(text)
        page.screenshot(path="/tmp/saashub_login_issue.png")
    else:
        print("Logged in! Going to submit product...")
        
        # Go to the product submission page
        page.goto("https://www.saashub.com/products/new", timeout=15000)
        page.wait_for_timeout(3000)
        print(f"Submit page URL: {page.url}")
        
        # Find and fill form fields
        page.fill("input[name='product[name]']", "Trackd")
        page.fill("input[name='product[tagline]']", "Find every subscription from your Gmail - no bank login")
        page.fill("textarea#product_description", BLURB)
        page.fill("input#product_website", "https://trackd-deanware.netlify.app")
        
        page.wait_for_timeout(1000)
        page.screenshot(path="/tmp/saashub_product_form.png")
        
        # Submit
        page.click("input[type='submit']")
        page.wait_for_timeout(5000)
        print(f"After submit: {page.url}")
        page.screenshot(path="/tmp/saashub_result.png")
        
        # Check result
        text = page.inner_text("body")[:600]
        print(f"Result: {text}")

    browser.close()