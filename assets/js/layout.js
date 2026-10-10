import { FLAGS } from './flags.js';
import { mountMainLayout } from './mainLayout.js';
import { mountLegacyLayout } from './legacyLayout.js';

// Choose and mount once, before loading any route data.
export function mountLayout(){
  document.documentElement.classList.toggle('beta', FLAGS.beta);
  document.documentElement.classList.toggle('debug', FLAGS.debug);
  return FLAGS.beta ? mountMainLayout() : mountLegacyLayout();
}
