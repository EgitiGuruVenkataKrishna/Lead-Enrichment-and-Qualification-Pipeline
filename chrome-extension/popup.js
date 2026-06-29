// popup.js
const API_URL = 'http://localhost:8000'; // For local dev, change to Railway URL in prod

document.addEventListener('DOMContentLoaded', () => {
    
    document.getElementById('fetchBtn').addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {action: "scrape"}, (response) => {
                if (response) {
                    document.getElementById('form-container').classList.remove('hidden');
                    document.getElementById('result-container').classList.add('hidden');
                    
                    if (response.type === 'person') {
                        document.getElementById('name').value = response.name || '';
                        let company = response.company || '';
                        if (!company && response.title && response.title.includes(' at ')) {
                            company = response.title.split(' at ')[1].trim();
                        }
                        
                        // Guess domain from company if company exists
                        let domain = '';
                        if (company) {
                            // simple heuristics: lowercase, remove spaces, add .com
                            domain = company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
                        }
                        
                        document.getElementById('company').value = company;
                        document.getElementById('domain').value = domain;
                    } else if (response.type === 'company') {
                        document.getElementById('name').value = '';
                        document.getElementById('company').value = response.company || '';
                        document.getElementById('domain').value = response.domain || '';
                    }
                } else {
                    alert('Could not extract data from page.');
                }
            });
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
            alert("Pipeline unreachable or error occurred.");
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('form-container').classList.remove('hidden');
        }
    });
});

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
                
                document.getElementById('res-status').textContent = lead.pipeline_status;
                document.getElementById('res-score').textContent = lead.icp_score !== null ? lead.icp_score : '-';
                
                let topSignal = '-';
                if (lead.buying_signals && lead.buying_signals.length > 0) {
                    topSignal = lead.buying_signals[0];
                }
                document.getElementById('res-signal').textContent = topSignal;
                
                let draftsGenerated = 'No';
                if (lead.outreach_drafts && lead.outreach_drafts.direct) draftsGenerated = 'Yes';
                document.getElementById('res-drafts').textContent = draftsGenerated;
            }
        } catch (e) {
            console.error("Polling error", e);
        }
    }, 2000);
}