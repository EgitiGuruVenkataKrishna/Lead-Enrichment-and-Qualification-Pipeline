import warnings
from bs4 import XMLParsedAsHTMLWarning
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

import requests
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
import models

# Shared headers for all HTTP requests
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9"
}


def _clean_html_text(soup) -> str:
    """Strip script/style tags and collapse whitespace from a BeautifulSoup tree."""
    for element in soup(["script", "style", "noscript", "svg"]):
        element.decompose()

    root = soup.body if soup.body else soup
    text = root.get_text(separator=" ")

    # Clean whitespace
    lines = (line.strip() for line in text.splitlines())
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    return " ".join(chunk for chunk in chunks if chunk)


def _fetch_page(url: str, timeout: int = 10) -> str:
    """Fetch a URL and return cleaned text. Returns empty string on failure."""
    try:
        response = requests.get(url, headers=HEADERS, timeout=timeout)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, "html.parser")
        return _clean_html_text(soup)
    except Exception as e:
        print(f"Failed to fetch {url}: {e}")
        return ""


def scrape_website(domain: str) -> str:
    """
    Scrape a company website across multiple pages for richer enrichment data.
    Tries: homepage, /about, /about-us, /team, /careers, /pricing
    """
    if not domain:
        return ""

    # Try HTTPS first, fall back to HTTP
    base_url = f"https://{domain}"
    homepage = _fetch_page(base_url)
    if not homepage:
        base_url = f"http://{domain}"
        homepage = _fetch_page(base_url)

    if not homepage:
        return ""

    # Scrape additional pages for richer data (team size, tech stack, hiring info)
    extra_pages = ["/about", "/about-us", "/team", "/careers", "/pricing"]
    extra_text_parts = []

    for path in extra_pages:
        text = _fetch_page(f"{base_url}{path}", timeout=5)
        if text and len(text) > 50:  # Only include if substantial content
            extra_text_parts.append(f"[{path}]: {text[:1500]}")

    # Combine homepage + extra pages
    combined = homepage[:3000]
    if extra_text_parts:
        combined += "\n\n" + "\n".join(extra_text_parts)

    return combined


def scrape_google_news(company_name: str) -> str:
    """Scrape Google News RSS feed for recent company mentions."""
    if not company_name:
        return ""

    url = f"https://news.google.com/rss/search?q={company_name}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.content, "html.parser")
        items = soup.find_all("item")

        headlines = []
        for item in items[:5]:  # Top 5 articles
            title_tag = item.find("title")
            if title_tag:
                headlines.append(title_tag.get_text())

        return " | ".join(headlines)
    except Exception as e:
        print(f"Error scraping Google News for company {company_name}: {e}")
        return ""


def scrape_linkedin(name: str, company: str) -> str:
    """
    Attempt to scrape a LinkedIn personal profile page.
    LinkedIn aggressively blocks non-authenticated scraping (403/429/999).
    This is expected to fail frequently — the pipeline degrades gracefully.
    """
    if not name or not company:
        return ""

    # Construct a best-guess public LinkedIn URL
    clean_name = "".join(c for c in name.lower() if c.isalnum() or c in " -").replace(" ", "-")
    clean_company = "".join(c for c in company.lower() if c.isalnum() or c in " -").replace(" ", "-")
    url = f"https://www.linkedin.com/in/{clean_name}-{clean_company}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        if response.status_code in [403, 429, 999]:
            print(f"LinkedIn scrape blocked with status {response.status_code} for {name} ({company}).")
            return ""
        response.raise_for_status()

        soup = BeautifulSoup(response.content, "html.parser")
        return _clean_html_text(soup)
    except requests.exceptions.RequestException as e:
        print(f"LinkedIn scrape failed/blocked for {name} ({company}): {e}")
        return ""
    except Exception as e:
        print(f"Unexpected error scraping LinkedIn for {name} ({company}): {e}")
        return ""


def scrape_linkedin_company(company: str) -> str:
    """
    Attempt to scrape a LinkedIn company page for additional data
    (employee count, about section, industry, headquarters).
    Subject to the same anti-scraping blocks as personal profiles.
    """
    if not company:
        return ""

    # Construct best-guess company page URL
    clean_company = "".join(c for c in company.lower() if c.isalnum() or c in " -").replace(" ", "-")
    url = f"https://www.linkedin.com/company/{clean_company}"

    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        if response.status_code in [403, 429, 999]:
            print(f"LinkedIn company scrape blocked with status {response.status_code} for {company}.")
            return ""
        response.raise_for_status()

        soup = BeautifulSoup(response.content, "html.parser")
        return _clean_html_text(soup)
    except requests.exceptions.RequestException as e:
        print(f"LinkedIn company scrape failed/blocked for {company}: {e}")
        return ""
    except Exception as e:
        print(f"Unexpected error scraping LinkedIn company page for {company}: {e}")
        return ""


def run_raw_extraction(lead_id: int, db: Session) -> dict:
    """
    Run all scraping sources for a lead. Each source is independent —
    if one fails, the others still run. This is the graceful degradation
    the assignment requires.
    """
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        return {"website_text": "", "news_text": "", "linkedin_text": "", "linkedin_company_text": ""}

    website_text = ""
    news_text = ""
    linkedin_text = ""
    linkedin_company_text = ""

    # Source 1: Company website (homepage + /about, /team, /careers, /pricing)
    if lead.email_domain:
        website_text = scrape_website(lead.email_domain)

    # Source 2: Google News
    if lead.original_company:
        news_text = scrape_google_news(lead.original_company)

    # Source 3: LinkedIn personal profile
    if lead.original_name and lead.original_company:
        linkedin_text = scrape_linkedin(lead.original_name, lead.original_company)

    # Source 4: LinkedIn company page
    if lead.original_company:
        linkedin_company_text = scrape_linkedin_company(lead.original_company)

    return {
        "website_text": website_text,
        "news_text": news_text,
        "linkedin_text": linkedin_text,
        "linkedin_company_text": linkedin_company_text
    }
