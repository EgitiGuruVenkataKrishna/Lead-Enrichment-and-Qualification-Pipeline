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

    // ── 1. Refine name from DOM ──
    const nameFromDom = extractText([
        'h1.text-heading-xlarge',
        '.text-heading-xlarge',
        '.top-card-layout__title',
        'h1'
    ]);
    if (nameFromDom) {
        name = nameFromDom.split('\n')[0].trim();
    }

    // ── 2. Get headline (title) from DOM ──
    const headlineFromDom = extractText([
        '.text-body-medium',
        '.pv-text-details__left-panel > div',
        '.pv-text-details__left-panel [class*="text-body"]',
        '.text-body-medium.break-words',
        '.pv-top-card--list .text-body-medium',
        '.top-card-layout__headline'
    ]);
    if (headlineFromDom) {
        title = headlineFromDom.split('\n')[0].trim();
    }

    // ── 3. Extract company from headline "at" / "@" pattern ──
    // e.g. "Senior Engineer at Google" or "Gen AI Intern @Dotsquares | ..."
    if (title) {
        const atMatch = title.match(/\b(?:at|@)\s+(.+?)(?:\s*[|·•]|$)/i);
        if (atMatch) {
            company = atMatch[1].trim();
        }
    }

    // ── 4. Extract company from DOM links if not in headline ──
    if (!company) {
        company = extractCompanyFromProfile(name, title);
    }

    // ── 5. Fallback: Parse document.title ──
    const rawTitle = document.title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
    const titleParts = rawTitle.split(' - ').map(s => s.trim());
    
    if (!name && titleParts.length >= 1) {
        name = titleParts[0];
    }
    if (!title && titleParts.length >= 2) {
        title = titleParts[1];
    }
    if (!company && titleParts.length >= 3) {
        company = titleParts.slice(2).join(' - ');
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
 * Helper to determine if an element is inside an ad container, right sidebar, or footer.
 * Helps prevent false positives like extracting "Free Online Courses" as the company.
 */
function isElementInSidebarOrFooter(el) {
    if (!el) return false;
    let parent = el.parentElement;
    while (parent) {
        const className = parent.className || "";
        const id = parent.id || "";
        const tagName = parent.tagName.toLowerCase();
        
        if (tagName === 'aside' || tagName === 'footer' || 
            className.includes('right-panel') || className.includes('sidebar') || 
            className.includes('footer') || className.includes('ad-container') ||
            id.includes('sidebar') || id.includes('footer')) {
            return true;
        }
        parent = parent.parentElement;
    }
    return false;
}

/**
 * Dedicated helper to cleanly extract company text from a DOM element,
 * avoiding concatenated job titles and duration strings.
 */
function getCleanCompanyText(link, name, title) {
    if (!link) return "";
    
    // Check spans inside the link first to avoid title + company concatenation
    const spans = link.querySelectorAll('span');
    for (const span of spans) {
        let text = span.textContent.trim();
        // Clean bullets
        text = text.split(/[·•|]/)[0].trim();
        
        // Skip job titles/words
        const jobWords = ['engineer', 'developer', 'manager', 'director', 'intern', 'analyst', 'specialist', 'consultant', 'lead', 'student', 'designer', 'architect', 'head', 'vice president', 'vp'];
        const isJobTitle = jobWords.some(word => text.toLowerCase().includes(word));
        
        if (text && text.length > 1 && text.length < 80 &&
            text !== name && text !== title && !isJobTitle &&
            !/^\d/.test(text) &&
            !text.includes(' mos') && !text.includes(' yrs') &&
            !text.includes(' yr') && !text.includes(' mo')) {
            return text;
        }
    }
    
    // Fallback: check link's own text content
    let text = link.textContent.trim().split('\n')[0].trim();
    text = text.split(/[·•|]/)[0].trim();
    
    // Check if the text itself contains a job title to avoid returning concatenated text
    const jobWords = ['engineer', 'developer', 'manager', 'director', 'intern', 'analyst', 'specialist', 'consultant', 'lead', 'student', 'designer', 'architect', 'head', 'vice president', 'vp'];
    const isJobTitle = jobWords.some(word => text.toLowerCase().includes(word));
    
    if (text && text.length > 1 && text.length < 100 && text !== name && !isJobTitle) {
        return text;
    }
    return "";
}

/**
 * Attempts to extract the current company name from various DOM locations.
 */
function extractCompanyFromProfile(name, title) {
    // Strategy A: Look for current company in the top card right panel (highest priority)
    const rightPanel = document.querySelector('.pv-text-details__right-panel') ||
                        document.querySelector('.pv-top-card--experience-list');
    if (rightPanel) {
        const links = rightPanel.querySelectorAll('a[href*="/company/"]');
        for (const link of links) {
            const text = getCleanCompanyText(link, name, title);
            if (text) return text;
        }
        
        // Fallback to any buttons/spans in right panel
        const items = rightPanel.querySelectorAll('button, span');
        for (const el of items) {
            let text = el.textContent.trim().split('\n')[0].trim();
            text = text.split(/[·•|]/)[0].trim();
            if (text && text.length > 1 && text.length < 100 &&
                text !== name && text !== title &&
                !text.toLowerCase().includes('mutual') && 
                !text.toLowerCase().includes('you both') &&
                !text.toLowerCase().includes('see all')) {
                return text;
            }
        }
    }

    // Strategy B: Look for company links in the top card area
    const topCardSelectors = [
        '.pv-top-card',
        'section.artdeco-card:first-of-type',
        '.scaffold-layout__top-card',
        '.profile-topcard',
        'main' // Fallback to main but filtered by isElementInSidebarOrFooter below
    ];
    for (const sel of topCardSelectors) {
        const card = document.querySelector(sel);
        if (card) {
            const companyLinks = card.querySelectorAll('a[href*="/company/"]');
            for (const link of companyLinks) {
                // Ignore any links inside sidebars or ads/footers (e.g. ad banners)
                if (isElementInSidebarOrFooter(link)) continue;
                
                const text = getCleanCompanyText(link, name, title);
                if (text) return text;
            }
        }
    }

    // Strategy C: Experience section — first company listed is usually current
    const expSection = document.querySelector('#experience');
    if (expSection) {
        const section = expSection.closest('section') || expSection.parentElement;
        if (section) {
            const spans = section.querySelectorAll('span[aria-hidden="true"]');
            for (const span of spans) {
                let text = span.textContent.trim();
                
                // If it contains a bullet, it's likely "Company Name · Employment Type"
                if (text.includes('·') || text.includes('•')) {
                    const parts = text.split(/[·•]/);
                    const possibleCompany = parts[0].trim();
                    const secondPart = parts[1].toLowerCase();
                    if (secondPart.includes('full-time') || secondPart.includes('part-time') || 
                        secondPart.includes('contract') || secondPart.includes('internship') || 
                        secondPart.includes('apprenticeship') || secondPart.includes('freelance')) {
                        return possibleCompany;
                    }
                }
                
                text = text.split(/[·•|]/)[0].trim();
                const jobWords = ['engineer', 'developer', 'manager', 'director', 'intern', 'analyst', 'specialist', 'consultant', 'lead', 'student', 'designer', 'architect', 'head', 'vice president', 'vp'];
                const isJobTitle = jobWords.some(word => text.toLowerCase().includes(word));
                
                if (text && text.length > 1 && text.length < 80 &&
                    text !== name && text !== title && !isJobTitle &&
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