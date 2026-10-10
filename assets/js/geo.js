// Distance approximation calibrated for Lima; keep planning estimates stable.
export const M_LAT = 110_574;
export const M_LON = 111_320 * Math.cos(-12.05 * Math.PI / 180);   // Lima

export function distM(lat1, lon1, lat2, lon2){
  return Math.hypot((lon1 - lon2) * M_LON, (lat1 - lat2) * M_LAT);
}

