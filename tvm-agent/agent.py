#!/usr/bin/env python3
"""TVM Agent v0.4: sync over HTTPS + disk telemetry + safe managed cleanup.

Runs separately from TVM Player v1.4: it only writes MP4s in videos/
whose names start tvm- and the supported managed playlist.json format.
Never deletes user-copied legacy videos.
"""
import argparse
import datetime as dt
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

LOG = logging.getLogger('tvm-agent')
ID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
SHA_RE = re.compile(r'^[0-9a-f]{64}$')
LOCALHOST = {'localhost', '127.0.0.1', '::1'}


def validate_id(value):
    return isinstance(value, str) and bool(ID_RE.fullmatch(value))


def video_filename(video_id):
    if not validate_id(video_id):
        raise ValueError('ID de video inválido')
    return f'tvm-{video_id}.mp4'


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Fecha no válida')
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix='.tvm-write-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(payload, out, ensure_ascii=False, indent=2)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def read_json(path, default):
    try:
        return json.loads(path.read_text('utf-8'))
    except FileNotFoundError:
        return default


def desired_playback(rows, now):
    """Use local wall clock so an already downloaded campaign can start offline."""
    chosen, used = [], set()
    for row in sorted(rows, key=lambda x: (x['position'], x['videoId'])):
        video_id = row['videoId']
        if video_id in used:
            continue
        if row['kind'] == 'manual' or (
            row['kind'] == 'scheduled' and timestamp(row['startsAt']) <= now and
            (row.get('endsAt') is None or now < timestamp(row['endsAt']))
        ):
            chosen.append({'file': video_filename(video_id), 'enabled': True})
            used.add(video_id)
    return chosen


def needed_media(rows, now):
    # Old cached campaigns that already expired are safe to remove locally.
    return {r['videoId'] for r in rows if r['kind'] == 'manual' or
            r.get('endsAt') is None or now < timestamp(r['endsAt'])}


def check_payload(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('files'), list) or len(payload['files']) > 500:
        raise ValueError('Respuesta del servidor inválida')
    if not str(payload.get('playlistVersion', '')).isdigit() or not isinstance(payload.get('cleanupGeneration'), int):
        raise ValueError('Metadatos del servidor inválidos')
    for f in payload['files']:
        if not isinstance(f, dict) or not validate_id(f.get('videoId')) or \
           f.get('fileName') != video_filename(f['videoId']) or \
           not isinstance(f.get('bytes'), int) or not (0 < f['bytes'] < 10**12) or \
           not isinstance(f.get('sha256'), str) or not SHA_RE.fullmatch(f['sha256']) or \
           f.get('kind') not in ('manual', 'scheduled') or not isinstance(f.get('position'), int):
            raise ValueError('Archivo no válido en la respuesta')
        if f['kind'] == 'scheduled':
            timestamp(f.get('startsAt'))
            if f.get('endsAt') is not None:
                timestamp(f['endsAt'])


class Agent:
    def __init__(self, config, home):
        self.home = Path(home).resolve()
        self.player = Path(config['player_dir']).expanduser().resolve()
        self.videos = self.player / 'videos'
        self.playlist = self.player / 'playlist.json'
        self.state_path = self.home / 'state.json'
        self.managed_path = self.home / 'managed.json'
        self.base = config['server_url'].rstrip('/')
        u = urlsplit(self.base)
        if (u.scheme != 'https' and not (u.scheme == 'http' and u.hostname in LOCALHOST)) or \
           not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
            raise ValueError('server_url debe ser una URL HTTPS sin rutas ni credenciales')
        self.token = config['token'].strip().lower()
        if not SHA_RE.fullmatch(self.token):
            raise ValueError('token inválido (debe tener 64 caracteres hexadecimales)')
        if not self.player.is_dir() or not (self.player / 'main.py').is_file() or not self.playlist.is_file():
            raise ValueError('player_dir no es una instalación válida de TVM Player v1.4')
        self.videos.mkdir(exist_ok=True)
        self.state = read_json(self.state_path, {'payload': None})
        self.managed = read_json(self.managed_path, {'files': {}})
        self.managed.setdefault('files', {})
        self.poll_seconds = max(30, min(1800, int(config.get('poll_seconds', 60))))

    def request(self, uri, method='GET', body=None, download=None):
        headers = {'Authorization': 'Bearer '+self.token, 'User-Agent': 'TVM-Agent/0.4'}
        if body is not None:
            headers['Content-Type'] = 'application/json'
            body = json.dumps(body).encode('utf-8')
        req = Request(self.base+'/api/device/'+uri, headers=headers, data=body, method=method)
        # stdlib verifies TLS certificates and hostname by default.
        with urlopen(req, timeout=60 if download else 25) as response:
            if download is not None:
                digest = hashlib.sha256()
                total = 0
                with download.open('wb') as target:
                    while True:
                        block = response.read(128*1024)
                        if not block:
                            break
                        target.write(block)
                        digest.update(block)
                        total += len(block)
                    target.flush()
                    os.fsync(target.fileno())
                return total, digest.hexdigest()
            return json.load(response)

    def safe_path(self, vid):
        path = self.videos / video_filename(vid)
        if path.is_symlink():
            raise ValueError('Archivo administrado es un enlace simbólico, operación bloqueada')
        return path

    def ensure_download(self, f):
        vid = f['videoId']
        final = self.safe_path(vid)
        existing = self.managed['files'].get(vid)
        if existing and final.is_file():
            st = final.stat()
            if existing.get('sha256') == f['sha256'] and st.st_size == f['bytes'] and st.st_mtime_ns == existing.get('mtimeNs'):
                return
        free = shutil.disk_usage(self.videos).free
        if free < f['bytes'] + 512*1024*1024:
            raise OSError(f'Espacio insuficiente para {f["name"]}; reservar 512 MB')
        tmp = self.videos / ('.tvm-'+vid+'.part')
        if tmp.is_symlink():
            raise ValueError('Archivo temporal es un enlace simbólico')
        try:
            size, digest = self.request('video/'+vid, download=tmp)
            if size != f['bytes'] or digest != f['sha256']:
                raise ValueError(f'Integridad inválida al descargar {f["name"]}')
            os.replace(tmp, final)
            st = final.stat()
            self.managed['files'][vid] = {'sha256': digest, 'bytes': size, 'mtimeNs': st.st_mtime_ns}
            atomic_json(self.managed_path, self.managed)
            LOG.info('Video descargado: %s (%d bytes)', vid, size)
        finally:
            tmp.unlink(missing_ok=True)

    def write_playlist(self, payload, now):
        available = []
        for row in payload['files']:
            f = self.safe_path(row['videoId'])
            if row['videoId'] in self.managed['files'] and f.is_file():
                available.append(row)
        selection = desired_playback(available, now)
        new = {'mode': 'managed', 'items': selection}
        old = read_json(self.playlist, None)
        if old == new:
            return
        # Respaldar playlist manual existente una sola vez. No se tocan los ejecutables del Player.
        previous = self.player / 'playlist.pre-tvm-agent.json'
        if not previous.exists():
            shutil.copy2(self.playlist, previous)
        atomic_json(self.playlist, new)
        LOG.info('Playlist actualizada: %d video(s)', len(selection))

    def cleanup(self, payload, now):
        desired = needed_media(payload['files'], now)
        changed = False
        for vid in list(self.managed['files']):
            if vid in desired:
                continue
            target = self.safe_path(vid)
            target.unlink(missing_ok=True)
            self.managed['files'].pop(vid, None)
            changed = True
            LOG.info('Video TVM retirado del tótem: %s', vid)
        if changed:
            atomic_json(self.managed_path, self.managed)

    def report(self, payload, error):
        disk = shutil.disk_usage(self.videos)
        files = []
        for vid in list(self.managed['files']):
            p = self.safe_path(vid)
            if p.is_file():
                files.append({'videoId': vid, 'bytes': p.stat().st_size})
        if len(files)>500:
            raise ValueError('Más de 500 videos administrados en el tótem')
        required = [f for f in payload['files'] if f['kind']=='manual' or
                    (f['kind']=='scheduled' and timestamp(f['startsAt'])<=time.time() and
                     (f.get('endsAt') is None or time.time()<timestamp(f['endsAt'])))]
        all_ready=all(f['videoId'] in self.managed['files'] for f in required)
        # La confirmación del comando llega solo después de limpiar con éxito.
        report = {'totalBytes': disk.total, 'usedBytes': disk.used, 'freeBytes': disk.free,
                  'videoBytes': sum(f['bytes'] for f in files), 'files': files,
                  'playlistVersion': str(payload['playlistVersion'] if all_ready and not error else self.state.get('lastAckVersion','0')),
                  'cleanupAck': int(payload['cleanupGeneration']) if not error else self.state.get('lastCleanupAck', 0),
                  'lastError': str(error)[:500] if error else None}
        self.request('report', method='POST', body=report)
        if not error:
            changed = self.state.get('lastCleanupAck') != report['cleanupAck']
            self.state['lastCleanupAck'] = report['cleanupAck']
            if all_ready:
                changed = changed or self.state.get('lastAckVersion') != report['playlistVersion']
                self.state['lastAckVersion'] = report['playlistVersion']
            if changed:
                atomic_json(self.state_path, self.state)

    def cycle(self):
        error = None
        try:
            payload = self.request('sync')
            check_payload(payload)
            if self.state.get('payload') != payload:
                self.state['payload'] = payload
                atomic_json(self.state_path, self.state)
        except Exception as exc:
            error = 'Sin conexión con servidor: '+str(exc)
            LOG.warning('%s; se conserva la programación descargada', error)
            payload = self.state.get('payload')
        if not payload:
            return
        now = time.time()
        if not error:
            needed = needed_media(payload['files'], now)
            failures = []
            for f in payload['files']:
                if f['videoId'] not in needed:
                    continue
                try:
                    self.ensure_download(f)
                except Exception as exc:
                    failures.append(f'{f["videoId"]}: {exc}')
                    LOG.error('Descarga incompleta: %s', failures[-1])
            if failures:
                error = 'Descarga incompleta: ' + '; '.join(failures[:2])
        # No borrar archivos al estar offline: una retirada pendiente aún no llegó.
        # Para campañas vencidas, el manifest sí deja de reproducirlas por fecha local.
        try:
            self.write_playlist(payload, now)
            if not error:
                self.cleanup(payload, now)
                self.report(payload, None)
            elif not error.startswith('Sin conexión'):
                self.report(payload, error)
        except Exception as exc:
            LOG.error('No se pudo actualizar el tótem: %s', exc)
            if not error or not error.startswith('Sin conexión'):
                try:
                    self.report(payload, str(exc))
                except Exception:
                    pass


def main():
    parser=argparse.ArgumentParser(description='TVM Agent independiente para Raspberry Pi')
    parser.add_argument('--once', action='store_true', help='sincronizar una vez y salir')
    parser.add_argument('--config', default=str(Path(__file__).with_name('config.json')))
    args=parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    try:
        conf_path = Path(args.config)
        if not conf_path.exists():
            raise ValueError('Falta config.json; copiá config.example.json y completalo')
        conf = json.loads(conf_path.read_text('utf-8'))
        agent = Agent(conf, Path(__file__).resolve().parent)
    except (ValueError, KeyError, OSError) as exc:
        LOG.error('Configuración: %s', exc)
        return 1
    LOG.info('Agente iniciado. Intervalo: %ss', agent.poll_seconds)
    while True:
        try:
            agent.cycle()
        except Exception as exc:
            LOG.exception('Fallo inesperado: %s', exc)
        if args.once:
            return 0
        time.sleep(agent.poll_seconds)

if __name__ == '__main__':
    sys.exit(main())
