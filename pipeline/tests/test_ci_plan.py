import json
import unittest
from unittest.mock import patch
from pipeline.ci.test_plan import ROOT, POLICY, select, release_base
from pipeline.ci.run_browser import command


class CiPlanTest(unittest.TestCase):
    def setUp(self):self.policy=json.loads(POLICY.read_text())

    def test_documents_do_not_start_chromium(self):
        plan=select(['docs/RECORRIDOS.md'],self.policy)
        self.assertFalse(plan['run_browser']);self.assertEqual(plan['mode'],'contracts-only')

    def test_planning_does_not_run_editor_random_sequences_or_route_suite(self):
        plan=select(['assets/js/explore.js','config/atu_station_locations.json'],self.policy)
        self.assertIn('tests/atuExplore.spec.js',plan['files'])
        self.assertNotIn('tests/routeEditor.spec.js',plan['files'])
        self.assertNotIn('tests/explore.spec.js',plan['files'])
        self.assertNotIn('tests/sidebar.spec.js',plan['files'])

    def test_combined_changes_add_their_impacts(self):
        plan=select(['assets/js/explore.js','pipeline/output/trip_graph.json','assets/js/theme.js'],self.policy)
        self.assertTrue({'explore','planner','style'}.issubset(plan['groups']))
        self.assertIn('tests/tripPlanner.spec.js',plan['files'])
        self.assertIn('tests/theme.spec.js',plan['files'])

    def test_core_unknown_and_missing_baseline_force_all_tests(self):
        all_files={p.relative_to(ROOT).as_posix() for p in (ROOT/'tests').glob('*.spec.js')}
        for files,reason in [(['pipeline/authoring/engine.py'],None),(['new-runtime/file.js'],None),([], 'Baseline unavailable')]:
            plan=select(files,self.policy,reason)
            self.assertEqual(set(plan['files']),all_files)
            self.assertEqual(len(plan['matrix']['include']),4)

    def test_changed_test_is_included_and_input_is_not_shell_code(self):
        plan=select(['tests/atuExplore.spec.js'],self.policy)
        self.assertIn('tests/atuExplore.spec.js',plan['files'])
        with self.assertRaises(ValueError):command(['tests/x.spec.js; echo secret'],'beta','1/1')
        with self.assertRaises(ValueError):command([],'beta','1/1')
        self.assertEqual(command(['tests/atuExplore.spec.js'],'beta','1/1')[0],'npx')

    def test_release_baseline_ignores_failed_and_cancelled_pushes(self):
        runs=[{'head_sha':'cancelled','conclusion':'cancelled'},{'head_sha':'failed','conclusion':'failure'},
              {'head_sha':'released','conclusion':'success'}]
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return json.dumps({'workflow_runs':runs}).encode()
        with patch('urllib.request.urlopen',return_value=Response()),patch('subprocess.run') as run:
            run.return_value.returncode=0
            self.assertEqual(release_base('Hardnyx/limarutas','token','head'),'released')
            self.assertEqual(run.call_count,1)


if __name__=='__main__':unittest.main()
