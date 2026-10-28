import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('tvm_agent', Path(__file__).resolve().parents[1] / 'agent.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
V1 = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
V2 = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'

class AgentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)
        self.player = self.dir / 'player'
        self.player.mkdir()
        (self.player / 'main.py').write_text('# player stable\n')
        (self.player / 'playlist.json').write_text(json.dumps({'mode':'folder','items': []}))
        (self.player / 'videos').mkdir()
        (self.player / 'videos' / 'personal.mp4').write_bytes(b'NO BORRAR')
        self.data = b'MP4 TEST DATA' * 120
        self.entry={'videoId':V1, 'fileName':mod.video_filename(V1),'name':'promo.mp4',
                    'bytes':len(self.data),'sha256':hashlib.sha256(self.data).hexdigest(),
                    'kind':'manual','position':0,'startsAt':None,'endsAt':None}
        self.config={'server_url':'https://example.org','token':'a'*64,'player_dir':str(self.player),'poll_seconds':60}
        self.agent = mod.Agent(self.config, self.dir / 'agent')
        self.payload={'playlistVersion':'1','cleanupGeneration':0,'files':[self.entry]}
        self.reports=[]

    def mock_request(self, uri, method='GET', body=None, download=None):
        if uri=='sync':
            return self.payload
        if uri=='video/'+V1:
            download.write_bytes(self.data)
            return len(self.data), hashlib.sha256(self.data).hexdigest()
        if uri=='report':
            self.reports.append(body)
            return {'ok':True}
        raise RuntimeError(f'Unexpected route: {uri}')

    def test_download_reports_real_files_and_cleanup_after_withdrawal(self):
        with patch.object(self.agent, 'request', side_effect=self.mock_request):
            self.agent.cycle()
            self.assertEqual((self.player/'videos'/mod.video_filename(V1)).read_bytes(), self.data)
            self.assertEqual(json.loads((self.player/'playlist.json').read_text())['items'],
                             [{'file':mod.video_filename(V1),'enabled':True}])
            self.assertEqual(self.reports[-1]['videoBytes'],len(self.data))
            self.assertEqual(self.reports[-1]['playlistVersion'],'1')
            self.payload={'playlistVersion':'2','cleanupGeneration':1,'files':[]}
            self.agent.cycle()
            self.assertFalse((self.player/'videos'/mod.video_filename(V1)).exists())
            self.assertTrue((self.player/'videos'/'personal.mp4').exists())
            self.assertEqual(self.reports[-1]['files'],[])
            self.assertEqual(self.reports[-1]['cleanupAck'],1)
            self.assertEqual((self.player/'main.py').read_text(),'# player stable\n')

    def test_schedule_starts_and_ends_locally_without_internet(self):
        now = time.time()
        row={**self.entry,'kind':'scheduled','startsAt':dt.datetime.fromtimestamp(now+70,dt.timezone.utc).isoformat(),
             'endsAt':dt.datetime.fromtimestamp(now+150,dt.timezone.utc).isoformat()}
        self.assertEqual(mod.desired_playback([row],now),[])
        self.assertEqual(len(mod.desired_playback([row],now+100)),1)
        self.assertEqual(mod.desired_playback([row],now+160),[])

    def test_rejects_bad_manifests_and_paths(self):
        with self.assertRaises(ValueError):mod.video_filename('../oops')
        with self.assertRaises(ValueError):mod.check_payload({**self.payload,'files':[{**self.entry,'fileName':'../../oops.mp4'}]})
        symlink=self.player/'videos'/mod.video_filename(V1)
        symlink.symlink_to(self.player/'videos'/'personal.mp4')
        with self.assertRaises(ValueError):self.agent.safe_path(V1)
        self.assertEqual((self.player/'videos'/'personal.mp4').read_bytes(),b'NO BORRAR')

    def test_invalid_http_device_url_is_rejected(self):
        bad={**self.config,'server_url':'http://example.org'}
        with self.assertRaises(ValueError):mod.Agent(bad, self.dir/'other')

if __name__=='__main__':unittest.main()
