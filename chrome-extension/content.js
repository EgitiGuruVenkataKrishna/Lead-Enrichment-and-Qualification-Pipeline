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
                
                // 2. Parse Title
                let docTitle = document.title.replace(' | LinkedIn', '');
                let parts = docTitle.split(' - ');
                
                // Get Title from document title if available
                if (parts.length >= 2) {
                    title = parts[1].trim();
                } else {
                    // Fallback to top card text if document.title is weird
                    const topCard = document.querySelector('section.artdeco-card') || document.body;
                    const lines = topCard.textContent.split('\n').map(s=>s.trim()).filter(s=>s.length > 0);
                    const nameIdx = lines.findIndex(l => l.includes(name));
                    if (nameIdx !== -1 && lines.length > nameIdx + 1) {
                        title = lines[nameIdx + 1];
                    }
                }

                // 3. Parse Company
                // PRIORITY 1: The Right Panel of the Top Card (Most accurate, exactly matches UI)
                const rightPanel = document.querySelector('.pv-top-card .pv-text-details__right-panel') || document.querySelector('section.artdeco-card .pv-text-details__right-panel');
                if (rightPanel) {
                    const companyLinks = rightPanel.querySelectorAll('a[href*="/company/"], a[href*="/school/"], button');
                    for (let link of companyLinks) {
                        let text = link.textContent.trim().split('\n').map(s=>s.trim()).filter(s=>s.length>0)[0];
                        if (text && text.length > 2 && text !== name && text !== title && !text.includes("You both")) {
                            company = text;
                            break;
                        }
                    }
                }
                
                // PRIORITY 2: Document Title
                if (!company && parts.length >= 3) {
                    company = parts[2].trim();
                }
                
                // PRIORITY 3: Extract from "at" or "@" in title
                if (!company) {
                    let lowerTitle = title.toLowerCase();
                    if (lowerTitle.includes(' at ')) {
                        company = title.split(/\sat\s/i)[1].trim();
                    } else if (lowerTitle.includes('@')) {
                        company = title.split(/@/)[1].trim();
                        if (company.includes('|')) company = company.split('|')[0].trim();
                    }
                }
                
                // PRIORITY 4: Look in Experience section
                if (!company) {
                    const expSection = document.querySelector('#experience')?.closest('section');
                    if (expSection) {
                        const spans = expSection.querySelectorAll('span[aria-hidden="true"]');
                        for (let span of spans) {
                            let text = span.textContent.trim();
                            if (text && text.length > 2 && text !== title && text !== name && !text.includes(" mos") && !text.includes(" yrs")) {
                                company = text;
                                break;
                            }
                        }
                    }
                }
                
                // PRIORITY 5: Look in Education section
                if (!company) {
                    const eduSection = document.querySelector('#education')?.closest('section');
                    if (eduSection) {
                        const spans = eduSection.querySelectorAll('span[aria-hidden="true"]');
                        for (let span of spans) {
                            let text = span.textContent.trim();
                            if (text && text.length > 2 && text !== title && text !== name) {
                                company = text;
                                break;
                            }
                        }
                    }
                }

                // Find Location
                const mainCard = document.querySelector('.pv-top-card') || document.querySelector('section.artdeco-card') || document.body;
                const locEl = mainCard.querySelector('.pb2 .text-body-small, .text-body-small');
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