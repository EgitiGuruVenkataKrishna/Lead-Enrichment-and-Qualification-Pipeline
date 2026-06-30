// content.js — LinkedIn Profile & Company Website Data Extractor
// Uses multiple fallback strategies for resilient extraction.
// LinkedIn DOM changes frequently — selectors are ordered from most stable to least stable.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrape") {
        const url = window.location.href;

        if (url.includes('linkedin.com/in/')) {
            // ─── LinkedIn Personal Profile Page ───
            const data = extractLinkedInProfile();
            sendResponse({
                type: 'person',
                name: data.name,
                title: data.title,
                company: data.company,
                location: data.location
            });
        } else if (url.includes('linkedin.com/company/')) {
            // ─── LinkedIn Company Page ───
            const data = extractLinkedInCompany();
            sendResponse({
                type: 'company',
                company: data.company,
                domain: data.domain
            });
        } else {
            // ─── Any Other Website ───
            const data = extractCompanyWebsite();
            sendResponse({
                type: 'company',
                company: data.company,
                domain: data.domain
            });
        }
    }
    return true; // Keep message channel open for async sendResponse
});


// ════════════════════════════════════════════════════════
//  LinkedIn Personal Profile Extraction
// ════════════════════════════════════════════════════════

function extractLinkedInProfile() {
    let name = "", title = "", company = "", location = "";

    // ── 1. Parse document.title (MOST STABLE) ──
    // Format: "Name - Title - Company | LinkedIn"  OR  "Name - Title | LinkedIn"
    const rawTitle = document.title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    const titleParts = rawTitle.split(' - ').map(s => s.trim());

    if (titleParts.length >= 1) {
        name = titleParts[0];
    }
    if (titleParts.length >= 2) {
        title = titleParts[1];
    }
    if (titleParts.length >= 3) {
        // Join remaining parts in case company name itself contains " - "
        company = titleParts.slice(2).join(' - ');
    }

    // ── 2. Refine name from DOM (more accurate than title tag) ──
    const nameFromDom = extractText([
        'h1.text-heading-xlarge',
        '.text-heading-xlarge',
        '.top-card-layout__title',
        'h1'
    ]);
    if (nameFromDom) {
        name = nameFromDom.split('\n')[0].trim();
    }

    // ── 3. Get headline from DOM ──
    // The headline is displayed right below the name (e.g., "CTO at Acme Corp")
    const headlineFromDom = extractText([
        'div.text-body-medium.break-words',
        '.pv-top-card--list .text-body-medium',
        '.top-card-layout__headline'
    ]);
    if (headlineFromDom) {
        const cleanHeadline = headlineFromDom.split('\n')[0].trim();
        // If title from document.title was empty or generic, use DOM headline
        if (!title || title.length < 3) {
            title = cleanHeadline;
        }
    }

    // ── 4. Extract company (multiple fallbacks) ──
    if (!company) {
        company = extractCompanyFromProfile(name, title);
    }

    // ── 5. Parse company from headline "at" pattern ──
    // e.g. "Senior Engineer at Google" or "CTO @ Startup Inc"
    if (!company && title) {
        const atMatch = title.match(/\b(?:at|@)\s+(.+?)(?:\s*[|·•]|$)/i);
        if (atMatch) {
            company = atMatch[1].trim();
        }
    }

    // ── 6. Extract location ──
    location = extractText([
        '.pv-top-card--list:nth-child(2) .text-body-small',
        'span.text-body-small.inline.t-black--light.break-words',
        '.top-card-layout__first-subline .top-card__subline-item',
        '.pb2 .text-body-small',
        '.text-body-small.t-black--light'
    ]);
    // Clean location — sometimes it includes "Contact info" or other text
    if (location) {
        location = location.split('\n')[0].trim();
        // Heuristic: locations usually contain a comma or are short city names
        if (location.length > 80 || location.toLowerCase().includes('contact')) {
            location = "";
        }
    }

    return { name, title, company, location };
}

/**
 * Attempts to extract the current company name from various DOM locations.
 */
function extractCompanyFromProfile(name, title) {
    // Strategy A: Look for company links in the top card area
    // LinkedIn renders the current company as a clickable link to /company/ page
    const topCard = document.querySelector('.pv-top-card') ||
                    document.querySelector('section.artdeco-card') ||
                    document.querySelector('main');
    if (topCard) {
        const companyLinks = topCard.querySelectorAll('a[href*="/company/"]');
        for (const link of companyLinks) {
            const text = link.textContent.trim().split('\n')[0].trim();
            if (text && text.length > 1 && text.length < 100 &&
                text !== name && !text.toLowerCase().includes('see all')) {
                return text;
            }
        }
    }

    // Strategy B: Look for the "current company" button/link in the top card right panel
    const rightPanel = document.querySelector('.pv-text-details__right-panel');
    if (rightPanel) {
        const buttons = rightPanel.querySelectorAll('a, button, span');
        for (const el of buttons) {
            const text = el.textContent.trim().split('\n')[0].trim();
            if (text && text.length > 1 && text.length < 100 &&
                text !== name && text !== title &&
                !text.includes('mutual') && !text.includes('You both')) {
                return text;
            }
        }
    }

    // Strategy C: Experience section — first company listed is usually current
    const expSection = document.querySelector('#experience');
    if (expSection) {
        const section = expSection.closest('section') || expSection.parentElement;
        if (section) {
            // Look for company name in aria-hidden spans (LinkedIn duplicates text for accessibility)
            const spans = section.querySelectorAll('span[aria-hidden="true"]');
            for (const span of spans) {
                const text = span.textContent.trim();
                // Skip duration strings like "3 yrs 2 mos", role titles, and the name itself
                if (text && text.length > 1 && text.length < 80 &&
                    text !== name && text !== title &&
                    !/^\d/.test(text) &&
                    !text.includes(' mos') && !text.includes(' yrs') &&
                    !text.includes(' yr') && !text.includes(' mo') &&
                    !text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s/i) &&
                    !text.match(/present/i)) {
                    return text;
                }
            }
        }
    }

    return "";
}


// ════════════════════════════════════════════════════════
//  LinkedIn Company Page Extraction
// ════════════════════════════════════════════════════════

function extractLinkedInCompany() {
    let company = "";
    let domain = "";

    // Company name from the page heading
    company = extractText([
        'h1.org-top-card-summary__title',
        'h1.top-card-layout__title',
        'h1 span'
    ]);

    // Fallback: document title — format: "CompanyName | LinkedIn"
    if (!company) {
        company = document.title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    }

    // Try to get website domain from the company page
    const websiteLink = document.querySelector('a[data-test-id="about-us__website"] span') ||
                        document.querySelector('.org-top-card-primary-actions__inner a[href*="http"]') ||
                        document.querySelector('.link-without-visited-state[href*="http"]');
    if (websiteLink) {
        try {
            const href = websiteLink.closest('a')?.href || websiteLink.href || websiteLink.textContent;
            const url = new URL(href.startsWith('http') ? href : `https://${href}`);
            domain = url.hostname.replace('www.', '');
        } catch (e) {
            // If URL parsing fails, try to extract from text content
            domain = websiteLink.textContent.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
        }
    }

    // Fallback domain: guess from company name
    if (!domain && company) {
        domain = company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
    }

    return { company, domain };
}


// ════════════════════════════════════════════════════════
//  Generic Company Website Extraction
// ════════════════════════════════════════════════════════

function extractCompanyWebsite() {
    let company = "";
    let domain = window.location.hostname.replace('www.', '');

    // Try structured data (JSON-LD) first — most accurate if available
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    if (jsonLd) {
        try {
            const data = JSON.parse(jsonLd.textContent);
            if (data.name) company = data.name;
            else if (data.organization?.name) company = data.organization.name;
            else if (data.publisher?.name) company = data.publisher.name;
        } catch (e) { /* ignore parse errors */ }
    }

    // Try Open Graph meta tag
    if (!company) {
        const ogSiteName = document.querySelector('meta[property="og:site_name"]');
        if (ogSiteName) company = ogSiteName.getAttribute('content') || '';
    }

    // Fallback: parse document title
    if (!company) {
        company = document.title
            .split(/[-|–—]/)[0]  // Take text before first separator
            .trim();
    }

    return { company, domain };
}


// ════════════════════════════════════════════════════════
//  Utility
// ════════════════════════════════════════════════════════

/**
 * Tries a list of CSS selectors in order, returns the first non-empty text match.
 */
function extractText(selectors) {
    for (const sel of selectors) {
        try {
            const el = document.querySelector(sel);
            if (el) {
                const text = el.textContent.trim();
                if (text.length > 0) return text;
            }
        } catch (e) { /* selector might be invalid, skip */ }
    }
    return "";
}