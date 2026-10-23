import argparse
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_dashboard_data as build
import steam_indie_watch as steam
import push_dashboard as push
from tracker_common import event_summary, snapshot_id, validate_events, write_json


class PipelineTests(unittest.TestCase):
    def setUp(self):
        build.TODAY = '2026-10-23'

    def rows(self):
        return [['10월', '10/29-11/1', 'Sample', '🇹🇭 태국', 'Bangkok', '전시회', '', 'https://example.com/']]

    def bundle(self, directory):
        events = build.build_events(self.rows(), year=2026)
        data = {'asOfDate': build.TODAY, 'generatedAt': '2026-10-23T01:00:00Z',
                'events': events, 'snapshotId': snapshot_id(events), 'summary': event_summary(events, build.TODAY)}
        history = {'events': [], 'totalTracked': len(events), 'snapshotId': data['snapshotId']}
        summary = build.build_summary(events)
        summary['snapshotId'] = data['snapshotId']
        for name, value in [('data.json', data), ('history.json', history), ('summary.json', summary)]:
            write_json(directory / name, value)
        return data

    def test_month_and_year_boundaries(self):
        for raw, end in [('7/31-8/3', '2026-08-03'), ('10/29-11/1', '2026-11-01'),
                         ('10/31-11/1', '2026-11-01'), ('11/30-12/2', '2026-12-02'),
                         ('12/31-1/2', '2027-01-02'), ('5/22-24 (금-일)', '2026-05-24')]:
            with self.subTest(raw=raw):
                self.assertEqual(build.parse_date(raw, 2026)[1], end)
        self.assertEqual(build.parse_date('2/29', 2028)[0], '2028-02-29')

    def test_reject_impossible_or_partial_dates(self):
        for raw in ['2/30', '2/29', '5/22-21', '10/29-garbage', '13/1']:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                build.parse_date(raw, 2026)

    def test_blank_cell_does_not_shift_url(self):
        cal = '## 🟢 확정 일정\n| 월 | 날짜 | 행사명 | 국가 | 장소 | 유형 | 접수 기간 | 링크 |\n|---|---|---|---|---|---|---|---|\n| 10월 | 10/29 | Sample | 🇹🇭 태국 | Bangkok | 전시회 | | https://example.com/ |\n## 🟡 연례\n'
        event = build.build_events(build.parse_calendar_events(cal))[0]
        self.assertEqual(event['url'], 'https://example.com/')
        self.assertEqual(event['submissionPeriod'], '')

    def test_stats_and_status_share_end_date_rule(self):
        events = build.build_events(self.rows())
        events[0].update(startDate='2026-10-22', endDate='2026-10-24')
        self.assertEqual(events[0]['status'], 'upcoming')
        self.assertEqual(event_summary(events, build.TODAY)['upcomingEvents'], 1)
        self.assertEqual(event_summary(events, build.TODAY)['upcoming30Days'], 0)

    def test_ids_survive_row_insertion_and_end_changes_are_recorded(self):
        previous = build.build_events(self.rows())
        added = ['1월', '1/1', 'Other', '🇰🇷 한국', '', '', '', '']
        current = build.build_events([added, *self.rows()], previous)
        event = next(e for e in current if e['name'] == 'Sample')
        self.assertEqual(event['id'], previous[0]['id'])
        event['endDate'] = '2026-11-02'
        history = build.merge_history({'events': []}, [event], previous)
        self.assertEqual([c['type'] for c in history['events']], ['changed'])

    def test_initial_baseline_does_not_mark_everything_new(self):
        history = build.merge_history({'events': []}, build.build_events(self.rows()), None)
        self.assertEqual(history['events'], [])
        self.assertIn('baselineCreatedAt', history)

    def test_unknown_links_and_submission_notes(self):
        self.assertIsNone(build.clean_url('-'))
        self.assertIsNone(build.clean_url('javascript:alert(1)'))
        self.assertEqual(build.clean_url('[site](https://example.com/)'), 'https://example.com/')
        self.assertEqual(build.submission_status('마감'), 'closed')
        self.assertEqual(build.submission_status('접수중 (미공개)'), 'open')

    def test_metadata_budget_rotates_and_keeps_cached_details(self):
        cached = {'appid': 1, 'name': 'Cached', 'genres': ['Indie'], 'developers': ['Dev']}
        games = [{'appid': 1, 'name': 'Cached'}, {'appid': 2, 'name': 'Missing'}]
        with patch.object(steam, 'fetch_appdetails', return_value={'genres': ['Action']} ) as fetch, patch.object(steam.time, 'sleep'):
            result = steam.enrich_games(games, 1, [cached])
        fetch.assert_called_once_with(2)
        self.assertEqual(result[0]['genres'], ['Indie'])
        self.assertEqual(result[1]['metadataStatus'], 'complete')

    def test_invalid_bundle_rejected_before_any_git_action(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            data = self.bundle(directory)
            data['events'][0]['endDate'] = '2026-10-01'
            write_json(directory / 'data.json', data)
            args = argparse.Namespace(data_dir=str(directory), include_ui=False, dry_run=True)
            with patch.object(push, 'git') as git, self.assertRaises(ValueError):
                push.publish(args)
            git.assert_not_called()

    def test_dry_run_leaves_source_checkout_and_state_untouched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repo, data = root / 'repo', root / 'generated'
            repo.mkdir()
            def git(*args):
                subprocess.run(['git', *args], cwd=repo, check=True, capture_output=True)
            git('init', '--initial-branch=main')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.com')
            (repo/'index.html').write_text('<script src="./app.js?v=1"></script>')
            (repo/'app.js').write_text('fetch("./data/data.json?v=1")')
            (repo/'styles.css').write_text('body {}')
            git('add', '.')
            git('commit', '-m', 'fixture')
            self.bundle(data)
            before = (repo/'index.html').read_text()
            args = argparse.Namespace(data_dir=str(data), include_ui=False, dry_run=True,
                                      repo_url=str(repo), work_dir=str(root/'live'), state_dir=str(root/'state'))
            push.publish(args)
            self.assertEqual((repo/'index.html').read_text(), before)
            self.assertFalse((root/'live').exists())
            self.assertFalse((root/'state').exists())


if __name__ == '__main__':
    unittest.main()
