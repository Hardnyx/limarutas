// Explain the existing ranking; this does not change how options are ordered.
export function explainRecommendation(option, { directReference, savingThreshold, winningIntegrated } = {}){
  if (winningIntegrated) return 'Combina servicios integrados y llega antes que la mejor opción sin transbordo.';
  if (!option.transfers && option.walkM <= 800) return 'Sin transbordo y con poca caminata.';
  if (option.transfers && directReference && option.minutes <= directReference.minutes - savingThreshold){
    return `Ahorra unos ${Math.round(directReference.minutes - option.minutes)} min frente a la mejor opción sin transbordo.`;
  }
  return 'Equilibra tiempo estimado, caminata y transbordos.';
}
