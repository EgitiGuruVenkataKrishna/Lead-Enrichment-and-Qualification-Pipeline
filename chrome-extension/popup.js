// popup.js
const API_URL = 'https://web-production-1f7a6.up.railway.app';

document.addEventListener('DOMContentLoaded', () => {

    document.getElementById('fetchBtn').addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
            const tab = tabs[0];
            const url = tab.url || '';

            if (url.includes('linkedin.com')) {
                // LinkedIn — content script is already injected via manifest
                chrome.tabs.sendMessage(tab.id, {action: "scrape"}, (response) => {
                    if (chrome.runtime.lastError || !response) {
                        showError('Could not extract data. Make sure you are on a LinkedIn profile page.');
                        return;
                    }
                    populateForm(response);
                });
            } else if (url.startsWith('http')) {
                // Non-LinkedIn website — inject content script programmatically
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content.js']
                    });
                    // Small delay to let the script register its message listener
                    setTimeout(() => {
                        chrome.tabs.sendMessage(tab.id, {action: "scrape"}, (response) => {
                            if (chrome.runtime.lastError || !response) {
                                // Fallback: extract from tab title and URL
                                const domain = new URL(url).hostname.replace('www.', '');
                                const company = tab.title.split(/[-|–—]/)[0].trim();
                                populateForm({ type: 'company', company, domain });
                                return;
                            }
                            populateForm(response);
                        });
                    }, 200);
                } catch (e) {
                    // If scripting fails (e.g., chrome:// pages), use tab metadata
                    try {
                        const domain = new URL(url).hostname.replace('www.', '');
                        const company = tab.title.split(/[-|–—]/)[0].trim();
                        populateForm({ type: 'company', company, domain });
                    } catch (ex) {
                        showError('Cannot extract data from this page.');
                    }
                }
            } else {
                showError('Please navigate to a LinkedIn profile or company website first.');
            }
        });
    });

    document.getElementById('sendBtn').addEventListener('click', async () => {
        const payload = {
            original_name: document.getElementById('name').value.trim() || null,
            original_company: document.getElementById('company').value.trim() || null,
            email_domain: document.getElementById('domain').value.trim() || null
        };

        if (!payload.original_name && !payload.original_company && !payload.email_domain) {
            alert('Please provide at least a name and company, or a domain.');
            return;
        }

        document.getElementById('form-container').classList.add('hidden');
        document.getElementById('error-msg').classList.add('hidden');
        document.getElementById('loading').classList.remove('hidden');

        try {
            const createRes = await fetch(`${API_URL}/api/leads/single`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });

            if (!createRes.ok) throw new Error('Failed to submit lead');
            const { lead_id } = await createRes.json();

            pollStatus(lead_id);

        } catch (e) {
            showError("Pipeline unreachable or error occurred.");
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('form-container').classList.remove('hidden');
        }
    });
});

function populateForm(response) {
    document.getElementById('form-container').classList.remove('hidden');
    document.getElementById('result-container').classList.add('hidden');
    document.getElementById('error-msg').classList.add('hidden');

    if (response.type === 'person') {
        document.getElementById('name').value = response.name || '';
        let company = response.company || '';

        // Extra fallback: try to parse company from title "XXX at Company"
        if (!company && response.title && /(?:\bat\b|@)\s*/i.test(response.title)) {
            company = response.title.split(/(?:\s+(?:at|@)\s+|\s*@\s*)/i).pop().trim();
        }

        // Guess domain from company if company exists
        let domain = '';
        if (company) {
            domain = company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
        }

        document.getElementById('company').value = company;
        document.getElementById('domain').value = domain;
    } else if (response.type === 'company') {
        document.getElementById('name').value = '';
        document.getElementById('company').value = response.company || '';
        document.getElementById('domain').value = response.domain || '';
    }
}

function showError(msg) {
    const el = document.getElementById('error-msg');
    el.textContent = msg;
    el.classList.remove('hidden');
}

async function pollStatus(leadId) {
    const interval = setInterval(async () => {
        try {
            const res = await fetch(`${API_URL}/api/leads/${leadId}`);
            if (!res.ok) return;
            const lead = await res.json();

            if (lead.pipeline_status === 'enriched' || lead.pipeline_status === 'failed') {
                clearInterval(interval);
                document.getElementById('loading').classList.add('hidden');

                const resContainer = document.getElementById('result-container');
                resContainer.classList.remove('hidden');

                // Status
                const statusEl = document.getElementById('res-status');
                statusEl.textContent = lead.pipeline_status;
                statusEl.className = 'status-badge ' + (lead.pipeline_status === 'enriched' ? 'status-success' : 'status-failed');

                // ICP Score
                const scoreEl = document.getElementById('res-score');
                const score = lead.icp_score !== null && lead.icp_score !== undefined ? lead.icp_score : '-';
                scoreEl.textContent = score;
                if (typeof score === 'number') {
                    scoreEl.style.color = score >= 60 ? '#10b981' : score >= 30 ? '#f59e0b' : '#ef4444';
                }

                // Top Signal
                let topSignal = 'None detected';
                if (lead.buying_signals && lead.buying_signals.length > 0) {
                    topSignal = lead.buying_signals[0];
                }
                document.getElementById('res-signal').textContent = topSignal;

                // Drafts
                let draftsGenerated = 'No';
                if (lead.outreach_drafts) {
                    if (typeof lead.outreach_drafts === 'string' && lead.outreach_drafts.trim().length > 0) {
                        draftsGenerated = 'Yes ✓';
                    } else if (typeof lead.outreach_drafts === 'object' && 
                               (lead.outreach_drafts.direct || lead.outreach_drafts.consultative || lead.outreach_drafts.social_proof)) {
                        draftsGenerated = 'Yes ✓';
                    }
                }
                document.getElementById('res-drafts').textContent = draftsGenerated;
            }
        } catch (e) {
            console.error("Polling error", e);
        }
    }, 2000);

    // Stop polling after 5 minutes to prevent infinite loops
    setTimeout(() => {
        clearInterval(interval);
        const loading = document.getElementById('loading');
        if (!loading.classList.contains('hidden')) {
            loading.classList.add('hidden');
            showError('Enrichment is taking longer than expected. Check the web dashboard for results.');
            document.getElementById('form-container').classList.remove('hidden');
        }
    }, 300000);
}