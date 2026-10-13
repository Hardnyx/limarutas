"""Reproduce reviewed GeoPDF symbol positions and affine map digitizations.

Acquisition dependencies are optional; the offline publication uses stdlib only.
Pixel anchors are review inputs, not automatically detected station names.
"""
from __future__ import annotations
import math


def geopdf_transform(pdf_path):
    import numpy as np
    from pypdf import PdfReader
    from pyproj import Transformer
    page=PdfReader(pdf_path).pages[0]
    viewports=[v.get_object() for v in page['/VP']]
    viewport=max(viewports, key=lambda v: abs((v['/BBox'][2]-v['/BBox'][0])*(v['/BBox'][3]-v['/BBox'][1])))
    measure=viewport['/Measure'].get_object()
    if measure['/Subtype']!='/GEO': raise ValueError('Viewport sin georreferenciación')
    geographic=np.array(measure['/GPTS'],float).reshape(-1,2)
    local=np.array(measure['/LPTS'],float).reshape(-1,2)
    forward=Transformer.from_crs(4326,str(measure['/GCS'].get_object()['/WKT']),always_xy=True)
    backward=Transformer.from_crs(str(measure['/GCS'].get_object()['/WKT']),4326,always_xy=True)
    projected=np.array([forward.transform(lon,lat) for lat,lon in geographic])
    matrix=np.linalg.lstsq(np.c_[local,np.ones(len(local))],projected,rcond=None)[0]
    residuals=np.linalg.norm(np.c_[local,np.ones(len(local))]@matrix-projected,axis=1)
    bbox=list(map(float,viewport['/BBox']))
    # ArcGIS writes this viewport with reversed y bounds. Input coordinates
    # use the rendered page's top-left origin, not the PDF bottom-left origin.
    def locate(x,y):
        pdf_y=float(page.mediabox.height)-y
        u=(x-bbox[0])/(bbox[2]-bbox[0])
        v=(pdf_y-bbox[1])/(bbox[3]-bbox[1])
        easting,northing=np.array([u,v,1])@matrix
        return [round(v,8) for v in backward.transform(easting,northing)]
    return locate, {'bbox':bbox,'lpts':local.tolist(),'gpts':geographic.tolist(),
        'fit_residual_m':residuals.tolist(),'projected_matrix':matrix.tolist(),'crs_wkt':str(measure['/GCS'].get_object()['/WKT'])}


def affine_map(controls, checks):
    import numpy as np
    from pyproj import Transformer
    forward=Transformer.from_crs(4326,32718,always_xy=True)
    backward=Transformer.from_crs(32718,4326,always_xy=True)
    design=np.array([[*c['pixel'],1] for c in controls],float)
    if len(controls)<4 or np.linalg.matrix_rank(design)!=3: raise ValueError('Controles insuficientes o colineales')
    projected=np.array([forward.transform(*c['coordinates']) for c in controls])
    matrix=np.linalg.lstsq(design,projected,rcond=None)[0]
    fit=np.linalg.norm(design@matrix-projected,axis=1)
    def locate(x,y):
        point=np.array([x,y,1])@matrix
        return [round(v,8) for v in backward.transform(*point)]
    errors=[math.dist(np.array([*c['pixel'],1])@matrix,forward.transform(*c['coordinates'])) for c in checks]
    if len(checks)<2: raise ValueError('Faltan controles independientes')
    return locate, {'controls':controls,'independent_checks':checks,'matrix':matrix.tolist(),
                   'fit_residual_m':fit.tolist(),'validation_residual_m':errors,
                   'validation_rmse_m':math.sqrt(sum(e*e for e in errors)/len(errors))}
