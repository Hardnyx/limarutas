// JSON transport; geometry decisions belong to the shared authoring service.
export class RouteAuthoringClient {
  async call(operation, fields = {}){
    const response = await fetch('./api/v1/operations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation, ...fields })
    });
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new Error('No hay un motor de recorridos en esta dirección. Abre el editor desde el servicio local.');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body.result;
  }
}
