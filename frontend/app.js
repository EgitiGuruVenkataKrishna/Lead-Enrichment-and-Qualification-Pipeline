// API Base URL
const API_BASE = '/api';

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = e.currentTarget.getAttribute('data-target');
        switchView(targetId);
    });
});

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(section => {
        section.classList.add('hidden');
        section.classList.remove('active');
    });
    document.getElementById(viewId).classList.remove('hidden');
    document.getElementById(viewId).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if(item.getAttribute('data-target') === viewId) {
            item.classList.add('active');
        }
    });

    // Refresh data based on view
    if (viewId === 'dashboard-view') fetchLeads();
    if (viewId === 'icp-view') fetchIcpConfig();
    if (viewId === 'status-view') fetchPipelineStatus();
}

// Toast
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => { toast.classList.add('hidden'); }, 3000);
}

// Format Badge
function getBadgeClass(status) {
    if(!status) return 'badge-pending';
    status = status.toLowerCase();
    if(status === 'pending') return 'badge-pending';
    if(status === 'enriching') return 'badge-enriching';
    if(status === 'enriched') return 'badge-enriched';
    if(status === 'failed') return 'badge-failed';
    return 'badge-pending';
}

// Fetch Leads for Dashboard
async function fetchLeads() {
    try {
        const res = await fetch(`${API_BASE}/leads`);
        const leads = await res.json();
        const tbody = document.getElementById('leads-table-body');
        tbody.innerHTML = '';
        
        leads.forEach(lead => {
            const tr = document.createElement('tr');
            tr.onclick = () => showLeadDetail(lead.id);
            
            const scoreStr = lead.icp_score !== null ? `${lead.icp_score}/100` : '-';
            const signalStr = (lead.buying_signals && lead.buying_signals.length > 0) ? lead.buying_signals[0] : '-';
            
            tr.innerHTML = `
                <td>${lead.original_name || '-'}</td>
                <td>${lead.original_company || '-'}</td>
                <td>${scoreStr}</td>
                <td><small>${signalStr.substring(0, 50)}${signalStr.length > 50 ? '...' : ''}</small></td>
                <td><span class="badge ${getBadgeClass(lead.pipeline_status)}">${lead.pipeline_status}</span></td>
                <td>${lead.crm_sync_status}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Error fetching leads:', e);
        showToast('Error fetching leads');
    }
}

// Lead Detail View
async function showLeadDetail(leadId) {
    try {
        const res = await fetch(`${API_BASE}/leads/${leadId}`);
        const lead = await res.json();
        
        document.getElementById('detail-name').textContent = lead.original_name || 'Unknown Lead';
        const badge = document.getElementById('detail-status');
        badge.className = `badge ${getBadgeClass(lead.pipeline_status)}`;
        badge.textContent = lead.pipeline_status;
        
        // Profile
        document.getElementById('detail-profile').innerHTML = `
            <p><strong>Company:</strong> ${lead.original_company || '-'}</p>
            <p><strong>Domain:</strong> ${lead.email_domain || '-'}</p>
            <p><strong>Role:</strong> ${lead.role || '-'} (${lead.seniority || '-'})</p>
            <p><strong>Size:</strong> ${lead.company_size || '-'}</p>
            <p><strong>Industry:</strong> ${lead.industry || '-'} / ${lead.sub_industry || '-'}</p>
            <p><strong>Tech Stack:</strong> ${lead.tech_stack || '-'}</p>
            <p><strong>Funding:</strong> ${lead.funding_status || '-'}</p>
        `;
        
        // Score
        document.getElementById('detail-score').textContent = lead.icp_score !== null ? lead.icp_score : '-';
        document.getElementById('detail-reasoning').textContent = lead.icp_reasoning || 'No reasoning available yet.';
        
        // Signals
        const signalsUl = document.getElementById('detail-signals');
        signalsUl.innerHTML = '';
        if (lead.buying_signals && lead.buying_signals.length > 0) {
            lead.buying_signals.forEach(s => {
                const li = document.createElement('li');
                li.textContent = s;
                signalsUl.appendChild(li);
            });
        } else {
            signalsUl.innerHTML = '<li>No clear buying signals detected.</li>';
        }
        
        // Drafts
        const draftsDiv = document.getElementById('detail-drafts');
        draftsDiv.innerHTML = '';
        
        if (lead.outreach_drafts && typeof lead.outreach_drafts === 'object') {
            for (const [tone, draft] of Object.entries(lead.outreach_drafts)) {
                if(!draft) continue;
                const box = document.createElement('div');
                box.className = 'draft-box';
                box.innerHTML = `
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <strong>${tone.charAt(0).toUpperCase() + tone.slice(1)} Variant</strong>
                        <button class="btn btn-secondary btn-copy" data-draft="${encodeURIComponent(draft)}">
                            <i class="fa-regular fa-copy"></i> Copy
                        </button>
                    </div>
                    <pre>${draft}</pre>
                `;
                draftsDiv.appendChild(box);
            }
            
            // Add copy listeners
            document.querySelectorAll('.btn-copy').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const text = decodeURIComponent(e.currentTarget.getAttribute('data-draft'));
                    navigator.clipboard.writeText(text).then(() => {
                        showToast('Draft copied to clipboard');
                    });
                });
            });
        } else {
            draftsDiv.innerHTML = '<p class="text-muted">Drafts not generated yet. Lead might be enriching or failed ICP qualification.</p>';
        }
        
        switchView('detail-view');
    } catch (e) {
        console.error('Error fetching lead detail:', e);
        showToast('Error loading lead detail');
    }
}

// CSV Upload handling
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('csv-file-input');
let selectedFile = null;

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        handleFileSelect(e.dataTransfer.files[0]);
    }
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFileSelect(e.target.files[0]);
    }
});

function handleFileSelect(file) {
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
        showUploadError('Please select a valid CSV file.');
        return;
    }
    selectedFile = file;
    document.getElementById('upload-error').classList.add('hidden');
    
    // Preview
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        if (lines.length === 0) {
            showUploadError('CSV file is empty.');
            return;
        }
        
        // Basic validation: requires original_name/original_company OR email_domain
        const header = lines[0].toLowerCase();
        if (!header.includes('name') && !header.includes('company') && !header.includes('domain')) {
            showUploadError('CSV headers must include original_name and original_company, OR email_domain.');
            return;
        }

        renderPreview(lines.slice(0, 6)); // header + 5 rows
    };
    reader.readAsText(file);
}

function showUploadError(msg) {
    const el = document.getElementById('upload-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    document.getElementById('csv-preview-container').classList.add('hidden');
}

function renderPreview(lines) {
    const table = document.getElementById('csv-preview-table');
    table.innerHTML = '';
    lines.forEach((line, index) => {
        const tr = document.createElement('tr');
        const cells = line.split(',');
        cells.forEach(cell => {
            const el = index === 0 ? document.createElement('th') : document.createElement('td');
            el.textContent = cell.trim();
            tr.appendChild(el);
        });
        table.appendChild(tr);
    });
    document.getElementById('csv-preview-container').classList.remove('hidden');
}

document.getElementById('btn-upload').addEventListener('click', async () => {
    if (!selectedFile) return;
    
    const formData = new FormData();
    formData.append('file', selectedFile);
    
    const btn = document.getElementById('btn-upload');
    btn.textContent = 'Uploading...';
    btn.disabled = true;
    
    try {
        const res = await fetch(`${API_BASE}/leads/upload`, {
            method: 'POST',
            body: formData
        });
        const result = await res.json();
        showToast(`Uploaded ${result.total_rows_processed} rows. ${result.successful_inserts} queued.`);
        
        // Reset
        selectedFile = null;
        document.getElementById('csv-preview-container').classList.add('hidden');
        fileInput.value = '';
        
        // Go to dashboard
        switchView('dashboard-view');
    } catch (e) {
        console.error(e);
        showToast('Upload failed');
    } finally {
        btn.textContent = 'Upload & Start Enrichment';
        btn.disabled = false;
    }
});

// ICP Config
async function fetchIcpConfig() {
    try {
        const res = await fetch(`${API_BASE}/icp`);
        if (res.ok) {
            const config = await res.json();
            document.getElementById('icp-size').value = config.target_company_size || '';
            document.getElementById('icp-industries').value = config.target_industries || '';
            document.getElementById('icp-tech').value = config.required_tech_stack || '';
            document.getElementById('icp-seniority').value = config.minimum_seniority || '';
            document.getElementById('icp-disqualify').value = config.disqualifying_signals || '';
        }
    } catch (e) {
        console.error(e);
    }
}

document.getElementById('icp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        target_company_size: document.getElementById('icp-size').value,
        target_industries: document.getElementById('icp-industries').value,
        required_tech_stack: document.getElementById('icp-tech').value,
        minimum_seniority: document.getElementById('icp-seniority').value,
        disqualifying_signals: document.getElementById('icp-disqualify').value
    };
    
    try {
        const res = await fetch(`${API_BASE}/icp`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        if (res.ok) showToast('ICP Configuration saved');
    } catch (e) {
        showToast('Failed to save ICP');
    }
});

document.getElementById('btn-preview-score').addEventListener('click', async () => {
    const payload = {
        target_company_size: document.getElementById('icp-size').value,
        target_industries: document.getElementById('icp-industries').value,
        required_tech_stack: document.getElementById('icp-tech').value,
        minimum_seniority: document.getElementById('icp-seniority').value,
        disqualifying_signals: document.getElementById('icp-disqualify').value
    };
    
    const btn = document.getElementById('btn-preview-score');
    btn.textContent = 'Running...';
    btn.disabled = true;
    
    try {
        const res = await fetch(`${API_BASE}/icp/preview`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        
        document.getElementById('preview-score-val').textContent = result.score || 0;
        document.getElementById('preview-reasoning').textContent = result.reasoning || 'No reasoning.';
        document.getElementById('preview-result').classList.remove('hidden');
    } catch (e) {
        showToast('Preview failed');
    } finally {
        btn.textContent = 'Run Preview';
        btn.disabled = false;
    }
});

// Pipeline Status
let statusInterval = null;

async function fetchPipelineStatus() {
    try {
        const res = await fetch(`${API_BASE}/status`);
        const statusList = await res.json();
        
        const ul = document.getElementById('status-list');
        const empty = document.getElementById('no-active-jobs');
        
        ul.innerHTML = '';
        if (statusList.length === 0) {
            ul.classList.add('hidden');
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
            ul.classList.remove('hidden');
            
            statusList.forEach(job => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <i class="fa-solid fa-circle-notch fa-spin"></i>
                    <div>
                        <strong>${job.original_name || job.original_company || 'Lead #' + job.lead_id}</strong>
                        <p class="text-muted" style="font-size:12px; margin-top:4px;">Status: Enriching...</p>
                    </div>
                `;
                ul.appendChild(li);
            });
        }
    } catch (e) {
        console.error(e);
    }
}

// Initial fetch
fetchLeads();
