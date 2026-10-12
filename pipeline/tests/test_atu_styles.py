import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pipeline.scripts.atu import styles
from pipeline.scripts.atu.sources import json_bytes

FIXTURE = b'''// const renderer = { invalid: "commented old version" };
const renderer = {type:"unique-value", field:"simbol", uniqueValueInfos:[
{value:"Eje Ferroviario Urbano L\\u00ednea 1",label:"L1",symbol:{type:"simple-line",color:"#1ba636",width:4,style:"dash"}},
{value:"Corredores Bus",label:"Bus",symbol:{type:"simple-line",color:"#dc6100",width:1.5}},
]};
const application = function(){ throw Error("must never execute"); };'''


class RendererTest(unittest.TestCase):
    def test_extract_live_renderer_and_keep_color_width_and_style(self):
        result=styles.renderer(FIXTURE)
        self.assertEqual(result['symbols']['Eje Ferroviario Urbano Línea 1']['color'],'#1ba636')
        self.assertEqual(result['symbols']['Eje Ferroviario Urbano Línea 1']['style'],'dash')
        self.assertEqual(result['symbols']['Corredores Bus']['width'],1.5)

    def test_changed_contract_html_expressions_and_duplicates_fail_closed(self):
        for raw in [b'<html>Error</html>',FIXTURE.replace(b'field:"simbol"',b'field:"tecnologia"'),
                    FIXTURE.replace(b'width:4',b'width:calculateWidth()'),
                    FIXTURE.replace(b'Corredores Bus',b'Eje Ferroviario Urbano L\\u00ednea 1')]:
            with self.subTest(raw=raw[:40]),self.assertRaises(ValueError):styles.renderer(raw)

    def test_conditional_renderer_sync_and_color_change_are_semantic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            with patch.object(styles,'fetch',return_value=(200,{'etag':'v1'},FIXTURE)):
                first,report=styles.synchronize(root,None)
            self.assertTrue(report['dataChanged'])
            with patch.object(styles,'fetch',return_value=(304,{},b'')) as fetch:
                second,report=styles.synchronize(root,first)
                self.assertEqual(fetch.call_args.args[1]['If-None-Match'],'v1')
            self.assertFalse(report['dataChanged']);self.assertEqual(report['downloadedBytes'],0)
            same=FIXTURE+b'\n// unrelated application change'
            with patch.object(styles,'fetch',return_value=(200,{},same)):
                _,report=styles.synchronize(root,first)
            self.assertFalse(report['dataChanged'])
            changed=FIXTURE.replace(b'#1ba636',b'#123456')
            with patch.object(styles,'fetch',return_value=(200,{},changed)):
                value,report=styles.synchronize(root,first)
            self.assertTrue(report['dataChanged']);self.assertEqual(value['symbols']['Eje Ferroviario Urbano Línea 1']['color'],'#123456')
            pointer=(root/'pmu-renderer-cache.json').read_bytes()
            with patch.object(styles,'fetch',return_value=(200,{},b'<html>Error</html>')):
                with self.assertRaises(ValueError):styles.synchronize(root,value)
            self.assertEqual((root/'pmu-renderer-cache.json').read_bytes(),pointer)
