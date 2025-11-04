const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const menu = document.getElementById('primary-menu');
const analyticsElements = document.querySelectorAll('[data-analytics]');
const leadForm = document.querySelector('.lead-form');
const successMessage = document.querySelector('.form-success');
const yearTarget = document.getElementById('current-year');

function updateYear() {
  if (yearTarget) {
    yearTarget.textContent = new Date().getFullYear();
  }
}

function toggleMenu() {
  if (!navToggle || !navLinks) return;
  const expanded = navToggle.getAttribute('aria-expanded') === 'true';
  navToggle.setAttribute('aria-expanded', String(!expanded));
  navLinks.classList.toggle('open', !expanded);
  if (!expanded) {
    menu?.querySelector('a')?.focus({ preventScroll: false });
  }
}

function closeMenuOnLinkClick(event) {
  if (event.target instanceof HTMLElement && event.target.tagName === 'A') {
    navToggle?.setAttribute('aria-expanded', 'false');
    navLinks?.classList.remove('open');
  }
}

function trackEvent(event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const { analytics } = target.dataset;
  if (!analytics) return;

  window.dispatchEvent(
    new CustomEvent('procura:analytics', {
      detail: {
        id: analytics,
        timestamp: Date.now(),
      },
    })
  );

  if (window.console && typeof window.console.info === 'function') {
    console.info(`[analytics] ${analytics}`);
  }
}

function handleFormSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;

  const formData = new FormData(form);
  if (!formData.get('consent')) {
    if (successMessage) {
      successMessage.textContent = 'Debes aceptar la política de privacidad.';
      successMessage.style.color = '#ff4d4f';
    }
    return;
  }

  if (successMessage) {
    successMessage.style.color = 'var(--color-accent)';
    successMessage.textContent = '¡Gracias! Te escribiremos en menos de 24 horas con tu acceso.';
  }
  form.reset();

  window.dispatchEvent(
    new CustomEvent('procura:form-submitted', {
      detail: Object.fromEntries(formData.entries()),
    })
  );
}

function init() {
  updateYear();

  if (navToggle) {
    navToggle.addEventListener('click', toggleMenu);
  }

  if (menu) {
    menu.addEventListener('click', closeMenuOnLinkClick);
  }

  analyticsElements.forEach((element) => {
    element.addEventListener('click', trackEvent);
  });

  if (leadForm) {
    leadForm.addEventListener('submit', handleFormSubmit);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
