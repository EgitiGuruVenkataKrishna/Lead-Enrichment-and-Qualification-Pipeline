document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && (tab.url.startsWith("http://") || tab.url.startsWith("https://"))) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    }, () => {
      chrome.tabs.sendMessage(tab.id, { action: "EXTRACT_DATA" }, (response) => {
        if (response) {
          if (response.original_name) document.getElementById("name").value = response.original_name;
          if (response.original_company) document.getElementById("company").value = response.original_company;
          if (response.email_domain) document.getElementById("domain").value = response.email_domain;
        }
      });
    });
  }
});

const form = document.getElementById("lead-form");
const loading = document.getElementById("loading");
const results = document.getElementById("results");
const errorMsg = document.getElementById("error-msg");

let pollInterval;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("name").value.trim();
  const company = document.getElementById("company").value.trim();
  const domain = document.getElementById("domain").value.trim();

  // Hide form, show spinner and reset error
  form.classList.add("hidden");
  loading.classList.remove("hidden");
  errorMsg.classList.add("hidden");

  try {
    const response = await fetch("http://localhost:8000/api/leads/single", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        original_name: name || null,
        original_company: company || null,
        email_domain: domain || null
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to queue lead: ${response.statusText}`);
    }

    const data = await response.json();
    const leadId = data.lead_id;

    // Poll every 2 seconds for enrichment completion
    pollInterval = setInterval(() => pollLeadStatus(leadId), 2000);

  } catch (err) {
    showError(err.message);
  }
});

async function pollLeadStatus(leadId) {
  try {
    const response = await fetch(`http://localhost:8000/api/leads/${leadId}`);
    if (!response.ok) {
      throw new Error(`Failed to query lead: ${response.statusText}`);
    }

    const lead = await response.json();

    if (lead.pipeline_status === "enriched") {
      clearInterval(pollInterval);
      showResults(lead);
    } else if (lead.pipeline_status === "failed") {
      clearInterval(pollInterval);
      showError("Lead enrichment pipeline failed.");
    }
  } catch (err) {
    clearInterval(pollInterval);
    showError(err.message);
  }
}

function showResults(lead) {
  loading.classList.add("hidden");
  results.classList.remove("hidden");

  const scoreEl = document.getElementById("res-score");
  scoreEl.textContent = lead.icp_score !== null ? `${lead.icp_score}/100` : "N/A";
  
  if (lead.icp_score !== null) {
    if (lead.icp_score >= 75) {
      scoreEl.className = "badge badge-green";
    } else if (lead.icp_score >= 50) {
      scoreEl.className = "badge badge-orange";
    } else {
      scoreEl.className = "badge badge-red";
    }
  }

  const signals = lead.buying_signals || [];
  document.getElementById("res-signals").textContent = signals.length > 0 ? signals.join(", ") : "No signals detected";

  const directDraft = lead.outreach_drafts?.direct || "No direct outreach generated.";
  const consultativeDraft = lead.outreach_drafts?.consultative || "No consultative outreach generated.";

  document.getElementById("res-draft-direct").value = directDraft;
  document.getElementById("res-draft-consultative").value = consultativeDraft;

  const copyBtn = document.getElementById("copy-draft-btn");
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(directDraft).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy Direct Draft";
      }, 1500);
    });
  };
}

function showError(msg) {
  loading.classList.add("hidden");
  form.classList.remove("hidden");
  errorMsg.textContent = msg;
  errorMsg.classList.remove("hidden");
}
