// Compatibility exports for existing integrations.
import { FLAGS } from './flags.js';
import { mountMainLayout } from './mainLayout.js';
let mounted;
export function applyBetaLayout(){ if (FLAGS.beta) mounted = mountMainLayout(); }
export function finishBetaLayout(){ mounted?.ready(); }
