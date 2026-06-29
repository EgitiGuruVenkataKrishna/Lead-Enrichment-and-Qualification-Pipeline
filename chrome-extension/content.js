// content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "scrape") {
        const url = window.location.href;
        
        if (url.includes('linkedin.com/in/')) {
            const extractProfile = () => {
                let name = "", title = "", company = "", location = "";
                
                // 1. Name Extraction
                const nameSelectors = [
                    'h1.text-heading-xlarge', 
                    '.pv-text-details__left-panel h1', 
                    '.top-card-layout__title'
                ];
                for (let sel of nameSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent.trim().length > 0) {
                        name = el.textContent.trim().split('\n')[0];
                        break;
                    }
                }
                
                // Fallback to Document Title for Name
                if (!name) {
                    let docTitle = document.title.replace(' | LinkedIn', '');
                    name = docTitle.includes(' - ') ? docTitle.split(' - ')[0].trim() : docTitle.trim();
                }
                
                // 2. Headline / Title Extraction
                const titleSelectors = [
                    'div.text-body-medium.break-words', 
                    '.pv-text-details__left-panel .text-body-medium',
                    '.top-card-layout__headline'
                ];
                for (let sel of titleSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent.trim().length > 0) {
                        title = el.textContent.trim();
                        break;
                    }
                }

                // Fallback for Title
                if (!title) {
                    let docTitle = document.title.replace(' | LinkedIn', '');
                    let parts = docTitle.split(' - ');
                    if (parts.length >= 2) title = parts[1].trim();
                }
                
                // 2.5 Define the Top Card (The section containing the name)
                // This guarantees we NEVER scrape the Highlights or Experience sections by mistake!
                let topCard = document.querySelector('.pv-top-card');
                if (!topCard) {
                    const h1 = document.querySelector('h1');
                    if (h1) topCard = h1.closest('section');
                }
                if (!topCard) topCard = document.body;

                // 3. Company Extraction (Optimized for modern UI cards)
                // Strategy: Only look strictly inside the topCard for links to companies/schools, or edit buttons.
                const companyEls = topCard.querySelectorAll('a[href*="/company/"], a[href*="/school/"], button[aria-label*="company" i], button[aria-label*="education" i]');
                for (let el of companyEls) {
                    // Extract text carefully to avoid invisible spans
                    let text = el.textContent.trim().split('\n').map(s=>s.trim()).filter(s=>s.length>0).pop();
                    if (text && text.length > 2 && text !== name && text !== title) {
                        company = text;
                        break;
                    }
                }

                // Fallback 1: Extract from Title string text splitting 
                if (!company && title && title.toLowerCase().includes(' at ')) {
                    const parts = title.split(/\sat\s/i);
                    company = parts[parts.length - 1].trim();
                }
                
                // Fallback 2: The Right Panel if no explicit links exist (Handles search URLs or unusual badges)
                if (!company) {
                    const rightPanel = topCard.querySelector('.pv-text-details__right-panel');
                    if (rightPanel) {
                        const items = rightPanel.querySelectorAll('li, button, a');
                        for (let item of items) {
                            let text = item.textContent.trim().split('\n').map(s=>s.trim()).filter(s=>s.length>0).pop();
                            if (text && text.length > 2 && text !== name && text !== title) {
                                company = text;
                                break;
                            }
                        }
                        
                        // Ultimate fallback: Just grab the raw visible text of the right panel
                        if (!company && rightPanel.innerText) {
                            let text = rightPanel.innerText.trim().split('\n').map(s=>s.trim()).filter(s=>s.length>0)[0];
                            if (text && text.length > 2 && text !== name && text !== title) {
                                company = text;
                            }
                        }
                    }
                }

                // 4. Location Extraction
                const locSelectors = [
                    '.pv-text-details__left-panel .text-body-small.inline',
                    '.top-card-layout__first-subline .top-card__subline-item',
                    'span.text-body-small.inline.break-words'
                ];
                for (let sel of locSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent.trim().length > 0) {
                        location = el.textContent.trim();
                        break;
                    }
                }

                return { name, title, company, location };
            };

            const data = extractProfile();
            sendResponse({
                type: 'person',
                name: data.name,
                title: data.title,
                company: data.company || 'Not found', 
                location: data.location || 'Not found'
            });
        } else {
            // Company Website Scrape Logic (Executes on external company domains)
            let companyName = document.title;
            if (companyName.includes('-')) {
                companyName = companyName.split('-')[0].trim();
            } else if (companyName.includes('|')) {
                companyName = companyName.split('|')[0].trim();
            }
            
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
