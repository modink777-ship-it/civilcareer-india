/* CivilCareer — Language Toggle (English / हिन्दी / ಕನ್ನಡ / తెలుగు) */
const TRANSLATIONS = {
  en: {
    nav_jobs: "Jobs",
    nav_govt: "Govt Jobs",
    nav_exams: "Exams",
    nav_prepare: "Prepare",
    nav_for_you: "For You",
    search_jobs: "Search civil engineering jobs...",
    apply_now: "Apply Now",
    last_date: "Last Date",
    vacancies: "Vacancies",
    view_all_jobs: "View All Jobs →",
    government_jobs: "Government Civil Jobs",
    private_jobs: "Private Civil Jobs",
    featured_badge: "Featured",
    closing_today: "⚡ Closing Today",
    fresh_jobs_heading: "Fresh civil engineering jobs",
    salary: "Salary",
    experience: "Experience",
    location: "Location",
    join_telegram: "Join Telegram for Free Job Alerts",
    post_job: "Post a Job",
    submit_resource: "Submit Resource",
    exam_tracker_nav: "Exam Tracker",
    salary_guide_nav: "Salary Guide",
    walkin_nav: "Walk-In Interviews",
    portfolio_nav: "My Portfolio",
    companies_nav: "Company Reviews",
    alert_subscribe: "Get WhatsApp Alerts",
    search_placeholder: "Job title, company, location...",
    filter_all: "All",
    filter_govt: "Government",
    filter_private: "Private",
    filter_psu: "PSU",
    filter_mnc: "MNC",
    loading: "Loading...",
    no_jobs: "No jobs found matching your criteria.",
    share: "Share",
    save: "Save",
    deadline: "Deadline",
    posted: "Posted",
  },
  hi: {
    nav_jobs: "नौकरियां",
    nav_govt: "सरकारी नौकरी",
    nav_exams: "परीक्षाएं",
    nav_prepare: "तैयारी करें",
    nav_for_you: "मेरे लिए",
    search_jobs: "सिविल इंजीनियरिंग नौकरियां खोजें...",
    apply_now: "अभी आवेदन करें",
    last_date: "अंतिम तिथि",
    vacancies: "पद",
    view_all_jobs: "सभी नौकरियां देखें →",
    government_jobs: "सरकारी सिविल नौकरियां",
    private_jobs: "निजी सिविल नौकरियां",
    featured_badge: "विशेष",
    closing_today: "⚡ आज अंतिम तिथि",
    fresh_jobs_heading: "नई सिविल इंजीनियरिंग नौकरियां",
    salary: "वेतन",
    experience: "अनुभव",
    location: "स्थान",
    join_telegram: "टेलीग्राम से नि:शुल्क जॉब अलर्ट पाएं",
    post_job: "नौकरी पोस्ट करें",
    submit_resource: "स्टडी मटेरियल शेयर करें",
    exam_tracker_nav: "परीक्षा ट्रैकर",
    salary_guide_nav: "वेतन गाइड",
    walkin_nav: "वॉक-इन इंटरव्यू",
    portfolio_nav: "मेरा पोर्टफोलियो",
    companies_nav: "कंपनी रिव्यू",
    alert_subscribe: "WhatsApp पर जॉब अलर्ट पाएं",
    search_placeholder: "पद, कंपनी, शहर...",
    filter_all: "सभी",
    filter_govt: "सरकारी",
    filter_private: "निजी",
    filter_psu: "PSU",
    filter_mnc: "MNC",
    loading: "लोड हो रहा है...",
    no_jobs: "कोई नौकरी नहीं मिली।",
    share: "शेयर करें",
    save: "सेव करें",
    deadline: "अंतिम तिथि",
    posted: "पोस्ट किया",
  },
  kn: {
    nav_jobs: "ಉದ್ಯೋಗಗಳು",
    nav_govt: "ಸರ್ಕಾರಿ ಉದ್ಯೋಗ",
    nav_exams: "ಪರೀಕ್ಷೆಗಳು",
    nav_prepare: "ತಯಾರಿ",
    nav_for_you: "ನನಗಾಗಿ",
    apply_now: "ಈಗ ಅರ್ಜಿ ಹಾಕಿ",
    last_date: "ಕೊನೆ ದಿನಾಂಕ",
    vacancies: "ಹುದ್ದೆಗಳು",
    search_placeholder: "ಹುದ್ದೆ, ಕಂಪನಿ, ನಗರ...",
    government_jobs: "ಸರ್ಕಾರಿ ಸಿವಿಲ್ ಉದ್ಯೋಗಗಳು",
    loading: "ಲೋಡ್ ಆಗುತ್ತಿದೆ...",
  },
  te: {
    nav_jobs: "ఉద్యోగాలు",
    nav_govt: "ప్రభుత్వ ఉద్యోగం",
    nav_exams: "పరీక్షలు",
    nav_prepare: "తయారీ",
    nav_for_you: "నా కోసం",
    apply_now: "ఇప్పుడు దరఖాస్తు చేయండి",
    last_date: "చివరి తేదీ",
    vacancies: "పోస్టులు",
    search_placeholder: "పదవి, కంపెనీ, నగరం...",
    government_jobs: "ప్రభుత్వ సివిల్ ఉద్యోగాలు",
    loading: "లోడ్ అవుతోంది...",
  }
};

window.t = function(key) {
  const lang = localStorage.getItem('cc_lang') || 'en';
  return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) 
    || TRANSLATIONS['en'][key] 
    || key;
};

window.applyLanguage = function(lang) {
  localStorage.setItem('cc_lang', lang);
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = window.t(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });
  document.querySelectorAll('.lang-option').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
};

document.addEventListener('DOMContentLoaded', () => {
  applyLanguage(localStorage.getItem('cc_lang') || 'en');
});
