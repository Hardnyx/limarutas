// config.js
// API key de CARTO Basemaps. El placeholder lo reemplaza el workflow de
// GitHub Pages con el secreto CARTO_API_KEY; no escribir la key aquí.
export const CARTO_API_KEY = '__CARTO_API_KEY__';

export const PATHS = {
  data:  'data',
  met:   'data/processed/metropolitano',
  corr:  'data/processed/corredores',
  metro: 'data/processed/metro',

  // Carpeta base Wikiroutes / Transporte público
  wr:    'data/processed/transporte',

  // Archivo principal de rutas de transporte Wikiroutes
  wrTransporte: 'data/processed/transporte/transporte.json',

  // Lista de corredores (metadatos de color y tipo)
  listaCorredores: 'config/lista_corredores.json',

  icons: {
    met:   'assets/icons/metropolitano',
    corr:  'assets/icons/corredores',
    metro: 'assets/icons/metro'
  }
};

export const COLOR_AN = '#FF4500';  // Alimentadores Norte
export const COLOR_AS = '#FFCD00';  // Alimentadores Sur

// Colores de corredores por primer dígito del servicio
export const COLOR_CORR = {
  '1': '#ffc928', // Amarillo
  '2': '#e4002b', // Rojo
  '3': '#003594', // Azul
  '4': '#662d91', // Morado
  '5': '#00843d'  // Verde
};

export const state = {
  map: null,
  baseLayers: { light: null, dark: null },
  currentBase: 'light',

  // Opciones
  dir: 'ambas',
  showStops: true,
  autoFit: true,

  // Catálogo
  catalog: null,

  // Dirección por ruta
  routeDir: new Map(),

  systems: {
    met:   {
      id: 'met',
      label: 'Metropolitano',
      stops: null,
      services: [],
      lineLayers: new Map(),
      stopLayers: new Map(),
      ui: { listReg: null, listExp: null, chkAll: null, chkReg: null, chkExp: null }
    },

    alim:  {
      id: 'alim',
      label: 'Alimentadores',
      stops: new Map(),
      services: [],
      lineLayers: new Map(),
      stopLayers: new Map(),
      ui: { listN: null, listS: null, chkAll: null, chkN: null, chkS: null }
    },

    corr:  {
      id: 'corr',
      label: 'Corredores',
      stops: new Map(),
      services: [],
      lineLayers: new Map(),
      stopLayers: new Map(),
      ui: { list: null, chkAll: null, groups: new Map() }
    },

    metro: {
      id: 'metro',
      label: 'Metro',
      stops: new Map(),
      services: [],
      lineLayers: new Map(),
      stopLayers: new Map(),
      ui: { list: null, chkAll: null }
    },

    // Wikiroutes (Transporte público)
    wr: {
      id: 'wr',
      label: 'Transporte público',
      routes: [],
      layers: new Map(),      // id -> L.LayerGroup
      stopLayers: new Map(),  // id -> L.LayerGroup (paraderos)
      bounds: new Map(),      // id -> LatLngBounds
      ui: { list: null, chkAll: null }
    }
  },

  // Vista de corredores basada en transporte.json
  corrWr: {
    services: [],
    groups: {
      principales_activas: [],
      principales_inactivas: [],
      alimentadoras_activas: [],
      alimentadoras_inactivas: []
    }
  },

  bulk: false,
  _searchIndex: []
};

export const keyFor = (systemId, id) =>
  `${systemId}:${String(id).toUpperCase()}`;

export const getDirFor = (systemId, id) =>
  state.routeDir.get(keyFor(systemId, id)) || 'ambas';

export const setDirFor = (systemId, id, dir) =>
  state.routeDir.set(keyFor(systemId, id), dir);
