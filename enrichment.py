import warnings
from bs4 import XMLParsedAsHTMLWarning
warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

import requests
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
import models

def scrape_website(domain: str) -> str:
    if not domain:
        return ""
    
    url = f"https://{domain}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/91.0.4472.124 Safari/537.36"
        )
    }
    
    try:
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
        except Exception:
            # Fallback to http if https fails
            url_http = f"http://{domain}"
            response = requests.get(url_http, headers=headers, timeout=10)
            response.raise_for_status()
            
        soup = BeautifulSoup(response.content, "html.parser")
        
        # Strip script and style elements
        for element in soup(["script", "style"]):
            element.decompose()
            
        # Extract text
        if soup.body:
            text = soup.body.get_text(separator=" ")
        else:
            text = soup.get_text(separator=" ")
            
        # Clean whitespace
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        cleaned_text = " ".join(chunk for chunk in chunks if chunk)
        
        return cleaned_text
    except Exception as e:
        print(f"Error scraping website for domain {domain}: {e}")
        return ""

def scrape_google_news(company_name: str) -> str:
    if not company_name:
        return ""
        
    url = f"https://news.google.com/rss/search?q={company_name}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/91.0.4472.124 Safari/537.36"
        )
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, "html.parser")
        items = soup.find_all("item")
        
        headlines = []
        for item in items[:5]:  # Extract top 3-5 articles
            title_tag = item.find("title")
            if title_tag:
                headlines.append(title_tag.get_text())
                
        return " | ".join(headlines)
    except Exception as e:
        print(f"Error scraping Google News for company {company_name}: {e}")
        return ""

def scrape_linkedin(name: str, company: str) -> str:
    if not name or not company:
        return ""
        
    # Construct a public LinkedIn profile search/URL best-guess
    clean_name = "".join(c for c in name.lower() if c.isalnum() or c in " -").replace(" ", "-")
    clean_company = "".join(c for c in company.lower() if c.isalnum() or c in " -").replace(" ", "-")
    url = f"https://www.linkedin.com/in/{clean_name}-{clean_company}"
    
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/91.0.4472.124 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9"
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code in [403, 429, 999]:
            print(f"LinkedIn scrape blocked with status code {response.status_code} for {name} ({company}).")
            return ""
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, "html.parser")
        
        # Strip script and style elements
        for element in soup(["script", "style"]):
            element.decompose()
            
        # Extract text
        if soup.body:
            text = soup.body.get_text(separator=" ")
        else:
            text = soup.get_text(separator=" ")
            
        # Clean whitespace
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        cleaned_text = " ".join(chunk for chunk in chunks if chunk)
        
        return cleaned_text
    except requests.exceptions.RequestException as e:
        print(f"LinkedIn scrape failed/blocked for {name} ({company}): {e}")
        return ""
    except Exception as e:
        print(f"Unexpected error scraping LinkedIn for {name} ({company}): {e}")
        return ""

def run_raw_extraction(lead_id: int, db: Session) -> dict:
    lead = db.query(models.Lead).filter(models.Lead.id == lead_id).first()
    if not lead:
        return {"website_text": "", "news_text": "", "linkedin_text": ""}
        
    website_text = ""
    news_text = ""
    linkedin_text = ""
    
    if lead.email_domain:
        website_text = scrape_website(lead.email_domain)
        
    if lead.original_company:
        news_text = scrape_google_news(lead.original_company)
        
    if lead.original_name and lead.original_company:
        linkedin_text = scrape_linkedin(lead.original_name, lead.original_company)
        
    return {
        "website_text": website_text,
        "news_text": news_text,
        "linkedin_text": linkedin_text
    }
