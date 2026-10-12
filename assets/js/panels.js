// panels.js
export function setPanelOpen(head, isOpen) {
    const panel = head.closest('.panel');
    if (!panel) return;
    const bodyId = head.dataset.target;
    const body = bodyId ? document.getElementById(bodyId) : null;

    panel.classList.toggle('open', isOpen);
    head.setAttribute('aria-expanded', String(!!isOpen));
    if (body) body.style.display = isOpen ? 'block' : 'none';
}

export function wirePanelTogglesOnce() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar || sidebar.dataset.togglesWired === '1') return;
  sidebar.dataset.togglesWired = '1';

  // Estado inicial: cerrar todos los paneles que no vengan marcados como .open
  sidebar.querySelectorAll('.panel-head[data-target]').forEach(head => {
    const panel = head.closest('.panel');
    const isOpen = !!(panel && panel.classList.contains('open'));
    setPanelOpen(head, isOpen);
  });

  const handleToggle = (head) => {
    const panel = head.closest('.panel');
    if (!panel) return;
    const nowOpen = !panel.classList.contains('open');
    setPanelOpen(head, nowOpen);
  };

  sidebar.addEventListener('click', (e) => {
    const head = e.target.closest('.panel-head');
    if (!head || !sidebar.contains(head)) return;
    if (e.target.closest('input[type="checkbox"]')) return;
    handleToggle(head);
  });

  sidebar.addEventListener('keydown', (e) => {
    const head = e.target.closest('.panel-head');
    if (!head || !sidebar.contains(head)) return;
    if (e.target.closest('input[type="checkbox"]')) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handleToggle(head);
  });
}
