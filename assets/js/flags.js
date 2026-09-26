// flags.js
// Banderas por URL:
//   la nueva interfaz ("beta") es la de todos; ?beta=0 vuelve a la anterior
//   (se recuerda en el navegador) y ?beta=1 regresa a la nueva
//   ?debug=1  herramientas de depuración (solo en esa visita)
const OLD_UI_KEY = 'limarutas.interfazAnterior';

function readBeta(params){
  const v = params.get('beta');
  try {
    if (v === '0') localStorage.setItem(OLD_UI_KEY, '1');
    else if (v === '1') localStorage.removeItem(OLD_UI_KEY);
    return localStorage.getItem(OLD_UI_KEY) !== '1';
  } catch {
    return v !== '0';
  }
}

const params = new URLSearchParams(window.location.search);

export const FLAGS = {
  beta: readBeta(params),
  debug: params.get('debug') === '1'
};

document.documentElement.classList.toggle('beta', FLAGS.beta);
document.documentElement.classList.toggle('debug', FLAGS.debug);
