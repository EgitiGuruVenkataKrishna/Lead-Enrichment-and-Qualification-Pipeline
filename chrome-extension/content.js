chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXTRACT_DATA") {
    const hostname = window.location.hostname.toLowerCase();
    let original_name = "";
    let original_company = "";
    let email_domain = "";

    if (hostname.includes("linkedin.com")) {
      // Extract profile name (typically in h1 tag)
      const nameEl = document.querySelector("h1");
      if (nameEl) {
        original_name = nameEl.innerText.trim();
      }

      // Try basic selectors for current experience / company
      const companyEl = document.querySelector(
        ".pv-text-details__right-panel-item-button, [data-field='experience_company_logo'] img, .experience-item__title + p, [data-field='experience'] .t-bold"
      );
      if (companyEl) {
        original_company = companyEl.innerText.trim();
      } else {
        // Fallback check of experience section
        const expSection = document.querySelector("#experience-section, [data-field='experience']");
        if (expSection) {
          const firstCompany = expSection.querySelector(".t-normal, .pv-entity__secondary-title");
          if (firstCompany) {
            original_company = firstCompany.innerText.trim().split("\n")[0];
          }
        }
      }
    } else {
      // Non-LinkedIn website: extract domain and guess company
      email_domain = hostname.replace(/^www\./, "");
      const domainParts = email_domain.split(".");
      if (domainParts.length > 0) {
        original_company = domainParts[0].charAt(0).toUpperCase() + domainParts[0].slice(1);
      }
    }

    sendResponse({
      original_name: original_name,
      original_company: original_company,
      email_domain: email_domain
    });
  }
  return true;
});
