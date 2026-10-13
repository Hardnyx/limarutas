"""Validate reviewed corridor identities without changing official PMU styling."""
import json
from pathlib import Path


def validate(root):
    root=Path(root)
    config=json.loads((root/'config/atu_project_styles.json').read_text())
    axes={f['id']:f for f in json.loads((root/'data/processed/planificado/red.geojson').read_text())['features']}
    codes={'amarillo':'1','rojo':'2','azul':'3','morado':'4','verde':'5'}
    for id,review in config['projects'].items():
        if id not in axes or axes[id]['properties']['modo']!='corredor':raise ValueError('Identidad de corredor sin eje bus documentado')
        if codes.get(review['corridor'])!=review['code'] or review['scope']!='cartographic_identity_only':
            raise ValueError('Color o alcance de corredor inválido')
        source=json.loads((root/'data/raw/atu_corredores'/f'{review["corridor"]}.json').read_text())
        if source['sha256']!=review['source_sha256'] or source['url']!=review['source_url'] or not source.get('evidence'):
            raise ValueError('Color de corredor sin fuente revisada')
        if review.get('additional_source_sha256'):
            extra=json.loads((root/'data/raw/atu_corredores/verde.json').read_text())
            if extra['sha256']!=review['additional_source_sha256'] or extra['url']!=review['additional_source_url']:
                raise ValueError('Identidad de corredor sin evidencia adicional revisada')
    from pipeline.scripts.atu.corridor_display import check
    check(root)
    return config
