"""
Playwright E2E Tests für Triumvirat Brettspiel
Testet alle kritischen User-Flows im Browser
"""
import pytest
import subprocess
import time
import signal
from playwright.sync_api import Page, expect


TEST_PORT = 5555
BASE_URL = f"http://localhost:{TEST_PORT}"


@pytest.fixture(scope="session")
def server():
    """Start und Stop des Test-Servers auf Port 5555"""
    # Server starten
    process = subprocess.Popen(
        ["node", "server.js"],
        env={"PORT": str(TEST_PORT)},
        cwd="/home/thilo/.openclaw/workspace/projects/triumvirat",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        preexec_fn=lambda: signal.signal(signal.SIGINT, signal.SIG_IGN)
    )
    
    # Warten bis Server bereit ist
    time.sleep(2)
    
    yield process
    
    # Server stoppen
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


@pytest.fixture
def browser_context(playwright):
    """Browser Context mit headless Chromium"""
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    yield context
    context.close()
    browser.close()


@pytest.fixture
def page(browser_context):
    """Neue Page für jeden Test"""
    page = browser_context.new_page()
    yield page
    page.close()


def test_01_lobby_loads(server, page: Page):
    """Test 1: Lobby laden - Seite öffnet, Titel sichtbar, Create-Button vorhanden"""
    page.goto(BASE_URL)
    
    # Titel prüfen
    expect(page.locator("h1")).to_contain_text("Triumvirat")
    
    # Create-Button vorhanden
    expect(page.locator("#create-btn")).to_be_visible()
    
    # Lobby ist aktiv
    lobby = page.locator("#lobby")
    expect(lobby).to_have_class("screen active")


def test_02_solo_game_start(server, page: Page):
    """Test 2: Solo-Spiel starten - Name eingeben, vs KI klicken, Canvas sichtbar"""
    page.goto(BASE_URL)
    
    # Name eingeben
    page.fill("#player-name", "TestPlayer")
    
    # vs KI Button klicken
    page.click("#ai-btn")
    
    # Warten bis Game Screen erscheint
    game_screen = page.locator("#game")
    expect(game_screen).to_have_class("screen active", timeout=3000)
    
    # Canvas vorhanden
    canvas = page.locator("#board")
    expect(canvas).to_be_visible()


def test_03_surrender_shows_overlay(server, page: Page):
    """Test 3: Aufgeben zeigt Overlay mit 'Du hast aufgegeben!' und Buttons"""
    page.goto(BASE_URL)
    
    # Solo-Spiel starten
    page.fill("#player-name", "TestPlayer")
    page.click("#ai-btn")
    
    # Warten bis Spiel läuft
    expect(page.locator("#game")).to_have_class("screen active", timeout=3000)
    
    # Confirm-Dialog automatisch bestätigen
    page.on("dialog", lambda dialog: dialog.accept())
    
    # Aufgeben
    page.click("#surrender-btn")
    
    # Overlay erscheint
    overlay = page.locator("#game-over-overlay")
    expect(overlay).not_to_have_class("hidden", timeout=2000)
    
    # Text prüfen
    winner_text = page.locator("#winner-text")
    expect(winner_text).to_contain_text("Du hast aufgegeben!")
    
    # Buttons vorhanden
    expect(page.locator("#rematch-btn")).to_be_visible()
    expect(page.locator("#new-game-btn")).to_be_visible()


def test_04_rematch_button_starts_new_game(server, page: Page):
    """Test 4: Nochmal-Button startet neues Spiel - Overlay verschwindet"""
    page.goto(BASE_URL)
    
    # Confirm-Dialog automatisch bestätigen
    page.on("dialog", lambda dialog: dialog.accept())
    
    # Solo-Spiel starten und aufgeben
    page.fill("#player-name", "TestPlayer")
    page.click("#ai-btn")
    expect(page.locator("#game")).to_have_class("screen active", timeout=3000)
    page.click("#surrender-btn")
    
    # Overlay ist sichtbar
    overlay = page.locator("#game-over-overlay")
    expect(overlay).not_to_have_class("hidden", timeout=2000)
    
    # Nochmal klicken
    page.click("#rematch-btn")
    
    # Overlay verschwindet
    expect(overlay).to_have_class("overlay hidden", timeout=2000)
    
    # Game Screen bleibt aktiv
    expect(page.locator("#game")).to_have_class("screen active")


def test_05_back_to_lobby(server, page: Page):
    """Test 5: Zurück zur Lobby - Nach Aufgeben zur Lobby zurückkehren"""
    page.goto(BASE_URL)
    
    # Confirm-Dialog automatisch bestätigen
    page.on("dialog", lambda dialog: dialog.accept())
    
    # Solo-Spiel starten und aufgeben
    page.fill("#player-name", "TestPlayer")
    page.click("#ai-btn")
    expect(page.locator("#game")).to_have_class("screen active", timeout=3000)
    page.click("#surrender-btn")
    
    # Warten bis Overlay erscheint
    expect(page.locator("#game-over-overlay")).not_to_have_class("hidden", timeout=2000)
    
    # Zurück zur Lobby
    page.click("#new-game-btn")
    
    # Lobby ist wieder aktiv
    expect(page.locator("#lobby")).to_have_class("screen active", timeout=2000)


def test_06_create_online_game(server, page: Page):
    """Test 6: Online-Spiel erstellen - Waiting-Screen mit Code erscheint"""
    page.goto(BASE_URL)
    
    # Name eingeben und Spiel erstellen
    page.fill("#player-name", "Host")
    page.click("#create-btn")
    
    # Waiting Screen erscheint
    waiting = page.locator("#waiting")
    expect(waiting).to_have_class("screen active", timeout=2000)
    
    # Code wird angezeigt
    code = page.locator("#invite-code")
    expect(code).to_be_visible()
    expect(code).not_to_have_text("---")


def test_07_join_online_game(server, browser_context):
    """Test 7: Online-Spiel beitreten - Zweiter Tab tritt bei, beide sehen Spielfeld"""
    # Tab 1: Spiel erstellen
    page1 = browser_context.new_page()
    page1.goto(BASE_URL)
    page1.fill("#player-name", "Host")
    page1.click("#create-btn")
    
    # Code auslesen
    expect(page1.locator("#waiting")).to_have_class("screen active", timeout=2000)
    game_code = page1.locator("#invite-code").inner_text()
    assert len(game_code) > 0 and game_code != "---"
    
    # Tab 2: Spiel beitreten
    page2 = browser_context.new_page()
    page2.goto(BASE_URL)
    page2.fill("#join-name", "Guest")
    page2.fill("#game-code", game_code)
    page2.click("#join-btn")
    
    # Beide Tabs zeigen Game Screen
    expect(page1.locator("#game")).to_have_class("screen active", timeout=5000)
    expect(page2.locator("#game")).to_have_class("screen active", timeout=5000)
    
    # Canvas in beiden Tabs sichtbar
    expect(page1.locator("#board")).to_be_visible()
    expect(page2.locator("#board")).to_be_visible()
    
    page1.close()
    page2.close()


def test_08_player_count_buttons(server, page: Page):
    """Test 8: Spieleranzahl-Buttons - 2/3 Spieler Buttons wechseln korrekt"""
    page.goto(BASE_URL)
    
    # Standard: 2 Spieler aktiv
    btn_2 = page.locator('.count-btn[data-count="2"]')
    btn_3 = page.locator('.count-btn[data-count="3"]')
    
    expect(btn_2).to_have_class("count-btn active")
    expect(btn_3).to_have_class("count-btn")
    
    # 3 Spieler auswählen
    btn_3.click()
    expect(btn_3).to_have_class("count-btn active")
    expect(btn_2).to_have_class("count-btn")
    
    # Zurück zu 2 Spielern
    btn_2.click()
    expect(btn_2).to_have_class("count-btn active")
    expect(btn_3).to_have_class("count-btn")


def test_09_solo_rematch_after_surrender(server, page: Page):
    """Test 9: Solo - Aufgeben → Nochmal → neues Spiel → erneut Aufgeben → Nochmal"""
    page.goto(BASE_URL)
    page.on("dialog", lambda dialog: dialog.accept())
    
    page.fill("#player-name", "TestPlayer")
    page.click("#ai-btn")
    expect(page.locator("#game")).to_have_class("screen active", timeout=3000)
    
    for round_num in range(3):
        # Surrender
        page.click("#surrender-btn")
        expect(page.locator("#game-over-overlay")).not_to_have_class("hidden", timeout=2000)
        expect(page.locator("#winner-text")).to_contain_text("aufgegeben")
        
        # Rematch button visible and clickable
        rematch = page.locator("#rematch-btn")
        expect(rematch).to_be_visible()
        expect(rematch).to_be_enabled()
        
        # Click Nochmal
        rematch.click()
        
        # Overlay disappears, game continues
        expect(page.locator("#game-over-overlay")).to_have_class("overlay hidden", timeout=2000)
        expect(page.locator("#game")).to_have_class("screen active")
        
        # Canvas still visible
        expect(page.locator("#board")).to_be_visible()


def test_10_pvp_rematch_after_surrender(server, browser_context):
    """Test 10: PvP Online - Aufgeben → beide klicken Revanche → neues Spiel"""
    p1 = browser_context.new_page()
    p1.on("dialog", lambda d: d.accept())
    p1.goto(BASE_URL)
    p1.fill("#player-name", "Host")
    p1.click("#create-btn")
    
    expect(p1.locator("#waiting")).to_have_class("screen active", timeout=2000)
    game_code = p1.locator("#invite-code").inner_text()
    
    p2 = browser_context.new_page()
    p2.on("dialog", lambda d: d.accept())
    p2.goto(BASE_URL)
    p2.fill("#join-name", "Guest")
    p2.fill("#game-code", game_code)
    p2.click("#join-btn")
    
    expect(p1.locator("#game")).to_have_class("screen active", timeout=5000)
    expect(p2.locator("#game")).to_have_class("screen active", timeout=5000)
    
    # P1 surrenders
    p1.click("#surrender-btn")
    
    # Both see overlay
    expect(p1.locator("#game-over-overlay")).not_to_have_class("hidden", timeout=2000)
    expect(p2.locator("#game-over-overlay")).not_to_have_class("hidden", timeout=2000)
    
    # Both see rematch button
    expect(p1.locator("#rematch-btn")).to_be_visible()
    expect(p2.locator("#rematch-btn")).to_be_visible()
    
    # P1 clicks rematch first — should show waiting status
    p1.locator("#rematch-btn").click()
    expect(p1.locator("#rematch-status")).not_to_have_class("hidden", timeout=2000)
    
    # P2 clicks rematch — game should restart
    p2.locator("#rematch-btn").click()
    
    # Both overlays disappear
    expect(p1.locator("#game-over-overlay")).to_have_class("overlay hidden", timeout=3000)
    expect(p2.locator("#game-over-overlay")).to_have_class("overlay hidden", timeout=3000)
    
    # Both still on game screen
    expect(p1.locator("#game")).to_have_class("screen active")
    expect(p2.locator("#game")).to_have_class("screen active")
    
    p1.close()
    p2.close()


def test_11_pvp_rematch_multiple_rounds(server, browser_context):
    """Test 11: PvP - Mehrere Runden Revanche hintereinander"""
    p1 = browser_context.new_page()
    p1.on("dialog", lambda d: d.accept())
    p1.goto(BASE_URL)
    p1.fill("#player-name", "Host")
    p1.click("#create-btn")
    
    expect(p1.locator("#waiting")).to_have_class("screen active", timeout=2000)
    game_code = p1.locator("#invite-code").inner_text()
    
    p2 = browser_context.new_page()
    p2.on("dialog", lambda d: d.accept())
    p2.goto(BASE_URL)
    p2.fill("#join-name", "Guest")
    p2.fill("#game-code", game_code)
    p2.click("#join-btn")
    
    expect(p1.locator("#game")).to_have_class("screen active", timeout=5000)
    expect(p2.locator("#game")).to_have_class("screen active", timeout=5000)
    
    for round_num in range(3):
        # Alternate who surrenders
        surrenderer = p1 if round_num % 2 == 0 else p2
        surrenderer.click("#surrender-btn")
        
        # Both see overlay
        expect(p1.locator("#game-over-overlay")).not_to_have_class("hidden", timeout=2000)
        expect(p2.locator("#game-over-overlay")).not_to_have_class("hidden", timeout=2000)
        
        # Both vote rematch
        p1.locator("#rematch-btn").click()
        p2.locator("#rematch-btn").click()
        
        # Both overlays disappear
        expect(p1.locator("#game-over-overlay")).to_have_class("overlay hidden", timeout=3000)
        expect(p2.locator("#game-over-overlay")).to_have_class("overlay hidden", timeout=3000)
    
    p1.close()
    p2.close()
