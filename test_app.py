from playwright.sync_api import sync_playwright
import time
import os

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    print("Loading App...")
    page.goto('http://localhost:3000')
    page.wait_for_load_state('networkidle')
    
    # Should redirect to login
    print(f"Current URL: {page.url}")
    
    # Click on "Create one" link (register mode)
    print("Navigating to Register...")
    # Link might be text 'Create one'
    page.get_by_text("Create one").click()
    page.wait_for_timeout(1000)
    
    # Fill in registration form
    print("Filling form...")
    page.get_by_placeholder("Ramesh Salunkhe").fill("Test Farmer")
    page.get_by_placeholder("you@example.com").fill("test_e2e@example.com")
    page.get_by_placeholder("At least 8 characters").fill("password123")
    
    # Submit registration
    print("Submitting...")
    page.get_by_role("button", name="Create account").click()
    
    # Wait for navigation to /home
    page.wait_for_url("**/home", timeout=10000)
    print(f"Post-login URL: {page.url}")
    
    # Take screenshot of home page
    os.makedirs(r"C:\Users\Shourya\.gemini\antigravity\brain\a55d3e30-5b45-438c-b834-678386d89709\scratch", exist_ok=True)
    screenshot_path = r"C:\Users\Shourya\.gemini\antigravity\brain\a55d3e30-5b45-438c-b834-678386d89709\scratch\home_screenshot.png"
    page.screenshot(path=screenshot_path)
    print(f"Screenshot saved to {screenshot_path}")
    
    # Go to chat
    print("Navigating to chat...")
    page.get_by_text("Start a new conversation").click()
    page.wait_for_timeout(2000)
    
    # Send a message
    print("Sending message...")
    page.get_by_placeholder("Ask about your vines…").fill("What causes powdery mildew?")
    page.get_by_role("button", name="Send message").click()
    
    # Wait for bot response (Wait for the text in the response)
    print("Waiting for response...")
    page.wait_for_selector(".bot-message", timeout=15000)
    
    # Take screenshot of chat
    chat_screenshot_path = r"C:\Users\Shourya\.gemini\antigravity\brain\a55d3e30-5b45-438c-b834-678386d89709\scratch\chat_screenshot.png"
    page.screenshot(path=chat_screenshot_path)
    print(f"Screenshot saved to {chat_screenshot_path}")
    
    bot_responses = page.locator(".bot-message").all_inner_texts()
    print("Bot Responses:")
    for text in bot_responses:
        print(text)

    browser.close()
