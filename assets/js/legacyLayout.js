// The legacy interface uses the shared route hosts declared in index.html.
// Its adapter leaves those controls in their original containers.
export function mountLegacyLayout(){
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) throw new Error('Missing legacy sidebar');
  sidebar.dataset.layoutMounted = 'legacy';
  return { ready(){ sidebar.dataset.layoutReady = '1'; } };
}
