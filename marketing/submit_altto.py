"""AlternativeTo - upload icon file directly and submit"""
import sys, os
from playwright.sync_api import sync_playwright

CHROME = "/opt/data/cache/chromium/chrome-linux/chrome"
DESC = "A Chrome extension that scans email receipts to find subscriptions."
ICON_PATH = "/tmp/trackd_favicon.png"

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
    print(f"Logged in")

    page.goto("https://alternativeto.net/manage-item/", timeout=20000)
    page.wait_for_timeout(3000)

    # Fill form
    page.fill("#name", "Trackd")
    page.fill("#tagLine", "Find subscriptions from Gmail - no bank login")
    page.fill("#websiteUrl", "https://trackd-deanware.netlify.app")
    page.fill("#description", DESC)
    page.select_option("#licenseCost", "Freemium")
    page.click("#licenseModelChoice-proprietary")

    page.click("#react-select-platforms-input")
    page.keyboard.type("Chrome")
    page.wait_for_timeout(1000)
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)

    page.click("#react-select-tags-input")
    page.keyboard.type("Subscription Manager")
    page.wait_for_timeout(1000)
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)

    # Upload icon via file input (skip URL approach)
    # The file input is hidden: input[type="file"][name="iconImage"] 
    # It's inside a dropzone, but we can use Playwright's set_input_files
    file_input = page.locator('input[type="file"][name="iconImage"]')
    if file_input.count() > 0:
        file_input.set_input_files(ICON_PATH)
        page.wait_for_timeout(2000)
        print("Icon file uploaded")
    else:
        print("File input not found!")
    
    # Submit form
    submit_result = page.evaluate("""
        () => {
            const form = document.querySelector('form[data-testid="form"]');
            const evt = new Event('submit', { bubbles: true, cancelable: true });
            const result = form.dispatchEvent(evt);
            return { dispatched: result, defaultPrevented: evt.defaultPrevented };
        }
    """)
    print(f"Submit: {submit_result}")
    page.wait_for_timeout(5000)

    # Check errors
    errors = page.evaluate("""
        () => {
            const errs = [];
            document.querySelectorAll('[class*=error], [class*=danger], [class*=invalid]').forEach(el => {
                if (el.innerText.trim()) errs.push(el.innerText.trim().substring(0,100));
            });
            return errs;
        }
    """)
    print(f"Errors: {errors}")
    
    print(f"URL: {page.url}")

    page.goto("https://alternativeto.net/my-submissions/", timeout=15000)
    page.wait_for_timeout(2000)
    text = page.inner_text("body")
    idx = text.find("Your app submissions")
    if idx >= 0:
        snippet = text[idx:idx+400]
        print(snippet)
        if "don't have any" in snippet:
            print("STATUS: FAILED")
        else:
            print("STATUS: SUCCESS!")
    else:
        print(text[:400])

    browser.close()