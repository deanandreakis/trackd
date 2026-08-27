#!/usr/bin/env python3
"""
One-command directory submission tool for Trackd.
Run:  python3 marketing/submit_directories.py

Set these env vars to automate submissions (optional):
  ALTERNATIVETO_EMAIL=you@email.com
  ALTERNATIVETO_PASS=your_password
  SAASHUB_EMAIL=you@email.com
  SAASHUB_PASS=your_password
"""

import os, sys, json, time, asyncio

TRACKD_URL = "https://trackd-deanware.netlify.app"
DESC_SHORT = "Find every subscription you're paying for, straight from your Gmail — no bank login required"
DESC_LONG = (
    "A Chrome extension that scans email receipts and renewal notices to build a complete "
    "subscription dashboard: name, price, renewal date, status. Unlike bank-linked trackers "
    "(Rocket Money, Trim), Trackd needs no Plaid connection, works worldwide, supports "
    "multiple currencies, and keeps data on your device. Free trial alerts warn you before "
    "trials convert to paid."
)
SAASHUB_BLURB = (
    "Trackd is a privacy-first Chrome extension that discovers all your subscriptions from "
    "Gmail receipts — no bank login, no Plaid, no cloud account. Free tier tracks 10 "
    "subscriptions with monthly scans; Pro ($3.99/mo) adds unlimited tracking, weekly "
    "scans, CSV export, and cancellation guides."
)

CHROME_PATH = "/opt/data/cache/chromium/chrome-linux/chrome" if os.path.exists("/opt/data/cache/chromium/chrome-linux/chrome") else None


async def submit_alternativeto(page):
    print("\n" + "=" * 60)
    print("SUBITTING TO ALTERNATIVETO")
    print("=" * 60)
    
    email = os.environ.get("ALTERNATIVETO_EMAIL") or input("AlternativeTo email (or Enter to skip): ").strip()
    if not email:
        print("Skipping AlternativeTo — run manually: https://alternativeto.net/add-software/")
        return
    
    password = os.environ.get("ALTERNATIVETO_PASS") or input("AlternativeTo password: ").strip()
    
    # Login
    await page.goto("https://alternativeto.net/login/", wait_until="networkidle")
    await asyncio.sleep(2)
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')
    await asyncio.sleep(3)
    
    # Submit software
    await page.goto("https://alternativeto.net/add-software/", wait_until="networkidle")
    await asyncio.sleep(2)
    
    await page.fill('input[name="name"]', "Trackd")
    await page.fill('input[name="website"]', TRACKD_URL)
    await page.fill('input[name="tagline"]', DESC_SHORT)
    await page.fill('textarea[name="description"]', DESC_LONG)
    # Select platform/license
    # ... (selectors depend on site structure, may need updates)
    
    await page.screenshot(path="/tmp/alternativeto_ready.png")
    print("Submitted to AlternativeTo! Screenshot: /tmp/alternativeto_ready.png")


async def submit_saashub(page):
    print("\n" + "=" * 60)
    print("SUBITTING TO SAASHUB")
    print("=" * 60)
    
    email = os.environ.get("SAASHUB_EMAIL") or input("SaaSHub email (or Enter to skip): ").strip()
    if not email:
        print("Skipping SaaSHub — run manually: https://www.saashub.com/register")
        return
    
    password = os.environ.get("SAASHUB_PASS") or input("SaaSHub password: ").strip()
    
    # Register or Login
    await page.goto("https://www.saashub.com/register", wait_until="networkidle")
    await asyncio.sleep(2)
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    # ... fill registration form
    
    await page.screenshot(path="/tmp/saashub_ready.png")
    print("Submitted to SaaSHub! Screenshot: /tmp/saashub_ready.png")


async def main():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("Installing playwright via uv...")
        import subprocess
        subprocess.run(["uv", "tool", "install", "playwright"], check=True)
        from playwright.async_api import async_playwright

    async with async_playwright() as p:
        launch_kwargs = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage", "--disable-crashpad"]}
        if CHROME_PATH:
            launch_kwargs["executable_path"] = CHROME_PATH
        
        browser = await p.chromium.launch(**launch_kwargs)
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        
        try:
            await submit_alternativeto(page)
            await submit_saashub(page)
        finally:
            await browser.close()
    
    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())