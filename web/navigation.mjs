// Keep views mounted so navigation preserves mission and review state.
const menu = document.querySelector('.dashboard-nav');
const links = [...menu.querySelectorAll('nav a')];
const sections = links.map(link => document.querySelector(link.hash));
const mobile = matchMedia('(max-width: 850px)');
const syncMenu = () => { menu.open = !mobile.matches; };
syncMenu();
mobile.addEventListener('change', syncMenu);

function showView(moveFocus = false) {
  const match = links.findIndex(link => link.hash === location.hash);
  const current = match < 0 ? 0 : match;
  sections.forEach((section, index) => {
    section.hidden = index !== current;
    section.classList.add('dashboard-view');
  });
  links.forEach((link, index) => {
    if (index === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (mobile.matches) menu.open = false;
  document.title = `${sections[current].getAttribute('aria-label') || '점검 기록'} · Solar Loop`;
  if (moveFocus) {
    sections[current].tabIndex = -1;
    sections[current].focus({preventScroll: true});
    window.scrollTo({top: 0, behavior: 'instant'});
  }
  document.dispatchEvent(new CustomEvent('dashboard:viewchange', {detail: {id: sections[current].id}}));
  // The map's existing ResizeObserver redraws its route on return.
}
links.forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  if (location.hash !== link.hash) history.pushState(null, '', link.hash);
  showView(true);
}));
window.addEventListener('hashchange', () => showView(true));
showView();
