// flags.js
// Banderas por URL para probar funciones antes de publicarlas:
//   ?beta=1   nueva interfaz (se recuerda en el navegador; ?beta=0 la apaga)
//   ?debug=1  herramientas de depuración (solo en esa visita)
const BETA_KEY = 'limarutas.beta';

function readBeta(params){
  const v = params.get('beta');
  try {
    if (v === '1') localStorage.setItem(BETA_KEY, '1');
    else if (v === '0') localStorage.removeItem(BETA_KEY);
    return localStorage.getItem(BETA_KEY) === '1';
  } catch {
    return v === '1';
  }
}

const params = new URLSearchParams(window.location.search);

export const FLAGS = {
  beta: readBeta(params),
  debug: params.get('debug') === '1'
};

document.documentElement.classList.toggle('beta', FLAGS.beta);
document.documentElement.classList.toggle('debug', FLAGS.debug);
