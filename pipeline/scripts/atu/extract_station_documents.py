"""Extract immutable evidence from the exact reviewed source document.

Parsing does not create stations or coordinates. A new hash needs a deliberate
source/config review; this command never silently accepts a new document.
"""
from __future__ import annotations
import argparse
import html
import json
import re
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from pipeline.scripts.atu.sources import sha,atomic_bytes


def extract(sid, source, body):
    if sha(body)!=source['sha256']: raise ValueError('Documento nuevo: revisar edición y conflictos antes de extraer')
    result={'source_id':sid,'source_sha256':source['sha256']}
    if source['format']=='pdf':
        import fitz
        document=fitz.open(stream=body,filetype='pdf')
        result['pages']=[{'pdf_page':n,'text':document[n-1].get_text()} for n in source['pages']]
        if sid=='san-isidro-tsv05':
            import io
            from pypdf import PdfReader
            page=PdfReader(io.BytesIO(body)).pages[0]
            viewports=[]
            for ref in page['/VP']:
                viewport=ref.get_object();measure=viewport['/Measure'].get_object()
                viewports.append({'bbox':list(map(float,viewport['/BBox'])),
                    'lpts':list(map(float,measure['/LPTS'])),'gpts':list(map(float,measure['/GPTS'])),
                    'gcs_wkt':str(measure['/GCS'].get_object()['/WKT'])})
            result['geopdf']={'page_height':float(page.mediabox.height),'viewports':viewports}
    elif source['format']=='html':
        text=re.sub('<script.*?</script>','',body.decode(),flags=re.S)
        text=html.unescape(re.sub('<[^>]+>',' ',text))
        result['text']=re.sub(r'\s+',' ',text).strip()
    else:
        result['text']=body.decode().split('### F7.')[1].split('### F8.')[0]
    raw=(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode()
    if sha(raw)!=source['extract_sha256']: raise ValueError('El parser produce evidencia diferente; revisar versión y extracción')
    return raw


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-id',required=True)
    parser.add_argument('--input',type=Path,required=True)
    args=parser.parse_args()
    config=json.loads((ROOT/'config/atu_station_sources.json').read_text())
    source=config['sources'][args.source_id]
    raw=extract(args.source_id,source,args.input.read_bytes())
    atomic_bytes(ROOT/source['extract'],raw)
    print('Extracto reproducido sin modificar estaciones ni coordenadas: '+args.source_id)
