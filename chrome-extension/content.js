// content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrape") {
        const url = window.location.href;
        
        if (url.includes('linkedin.com/in/')) {
            const extractProfile = () => {
                let name = "", title = "", company = "", location = "";
                
                // 1. Name
                const selectors = ['h1.text-heading-xlarge', '.text-heading-xlarge', '.top-card-layout__title', 'h1'];
                for (let sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent.trim().length > 0) {
                        name = el.textContent.trim().split('\n')[0];
                        break;
                    }
                }
                
                if (!name) {
                    let docTitle = document.title.replace(' | LinkedIn', '');
                    if (docTitle.includes(' - ')) name = docTitle.split(' - ')[0].trim();
                    else name = docTitle.trim();
                }
                
                // 2. Parse Top Card
                const topCard = document.querySelector('main section') || document.querySelector('.pv-top-card') || document.body;
                
                // Find Headline (Title)
                const lines = topCard.textContent.split('\n').map(s=>s.trim()).filter(s=>s.length > 0);
                const nameIdx = lines.findIndex(l => l.includes(name));
                if (nameIdx !== -1) {
                    for (let i = nameIdx + 1; i < nameIdx + 4 && i < lines.length; i++) {
                        let line = lines[i];
                        if (line.match(/^\(.*\)$/)) continue; // skip (He/Him)
                        if (!title) {
                            title = line;
                            break;
                        }
                    }
                }
                
                // Find Company
                // Method 1: Right-panel badges (most reliable for current status)
                const rightItems = topCard.querySelectorAll('.pv-text-details__right-panel li button, .pv-text-details__right-panel li a');
                for (let item of rightItems) {
                    let text = item.textContent.trim().split('\n').map(s=>s.trim()).filter(s=>s.length>0)[0];
                    if (text && text.length > 2 && text !== name && text !== title) {
                        company = text;
                        break;
                    }
                }
                
                // Method 2: Explicit links (if right panel empty)
                if (!company) {
                    const companyLinks = topCard.querySelectorAll('a[href*="/company/"], a[href*="/school/"]');
                    for (let link of companyLinks) {
                        let text = link.textContent.trim().split('\n').map(s=>s.trim()).filter(s=>s.length>0)[0];
                        if (text && text.length > 2 && text !== name && text !== title) {
                            company = text;
                            break;
                        }
                    }
                }
                
                // Fallbacks
                if (!title) {
                    let docTitle = document.title.replace(' | LinkedIn', '');
                    let parts = docTitle.split(' - ');
                    if (parts.length >= 2) title = parts[1].trim();
                }
                
                if (!company && title.toLowerCase().includes(' at ')) {
                    company = title.split(/\sat\s/i)[1].trim();
                }
                
                if (!company) {
                    const expSection = document.querySelector('#experience')?.closest('section');
                    if (expSection) {
                        const spans = expSection.querySelectorAll('span[aria-hidden="true"]');
                        if (spans.length >= 2) company = spans[1].textContent.trim();
                        else if (spans.length >= 1) company = spans[0].textContent.trim();
                    }
                }

                // Find Location
                const locEl = topCard.querySelector('.pb2 .text-body-small, .text-body-small');
                if (locEl) location = locEl.textContent.trim();

                return { name, title, company, location };
            };

            const data = extractProfile();
            sendResponse({
                type: 'person',
                name: data.name,
                title: data.title,
                company: data.company, 
                location: data.location
            });
        } else {
            // Company Website
            let companyName = document.title.split('-')[0].split('|')[0].trim();
            let domain = window.location.hostname.replace('www.', '');
            sendResponse({
                type: 'company',
                company: companyName,
                domain: domain
            });
        }
    }
    return true; 
});