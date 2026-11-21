"""Regression for the locally built sigmark-lan-api image. Never contacts a live repository."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import json
import subprocess
import time
import urllib.error
import urllib.request
import uuid


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def wait(check):
    for _ in range(60):
        try:
            return check()
        except (OSError, subprocess.CalledProcessError):
            time.sleep(.35)
    raise RuntimeError('Fixture failed to start')


def main():
    name = 'sigmark-qa-' + uuid.uuid4().hex[:12]
    with ExitStack() as stack:
        docker('network', 'create', name)
        stack.callback(docker, 'network', 'rm', name)
        def start(*args):
            cid = docker('run', '-d', '--rm', '--network', name, *args)
            stack.callback(docker, 'stop', '-t', '1', cid)
            return cid
        pg = start('--name', name+'-pg', '--tmpfs', '/var/lib/postgresql/data', '-e',
                   'POSTGRES_PASSWORD=fixture', 'postgres:17-alpine')
        wait(lambda: docker('exec', pg, 'pg_isready', '-U', 'postgres'))
        api = start('-e', 'DATABASE_URL=postgres://postgres:fixture@'+name+'-pg/postgres?sslmode=disable',
                    '-e', 'LAN_BATCH=qa-assets', '-e', 'ADMIN_TOKEN=fixture', '-p', '127.0.0.1::8080', 'sigmark-lan-api')
        base = 'http://' + docker('port', api, '8080/tcp')
        def request(path, body=None, key=None):
            headers = {'Authorization':'Bearer fixture'} if body is None else {'X-SigMark-Client':'android-lan','Content-Type':'application/json'}
            if key: headers['X-SigMark-Asset-Key'] = key
            data = json.dumps(body).encode() if body is not None else None
            with urllib.request.urlopen(urllib.request.Request(base+path, data=data, headers=headers), timeout=5) as response:
                return json.load(response)
        wait(lambda: request('/readyz'))
        def sample():
            return dict(requestId=str(uuid.uuid4()),schemaVersion=4,fieldSetVersion=7,appVersion='0.18.1',collectorVersion='0.18.1',
                        capturedAtEpochMs=int(time.time()*1000),model='QA',androidApi=35,network='wifi',wifiBand='5',radio='unknown',
                        metrics=[dict(key='system.selinux',status='RESTRICTED',reason='ACCESS_DENIED')],
                        parameters=[dict(group='system',key='patch',label='patch',value='2026-07-05',status='AVAILABLE',source='fixture')],
                        coverage=[dict(group='system',available=1,restricted=0,unavailable=0,errors=0)])
        def upload(s, key=None): return request('/api/v1/reports',s,key)
        a, key = sample(), str(uuid.uuid4())
        with ThreadPoolExecutor(max_workers=4) as pool:
            receipts = list(pool.map(lambda _: upload(a,key),range(4)))
        first=receipts[0]
        assert first['assetLinked'] is True and all(r==first for r in receipts)
        assert upload(a)==first  # association on receipt describes storage, not supplied header
        b=upload(sample(),key)
        assert b['reportId']!=first['reportId'] and b['assetLinked'] is True
        unlinked=sample(); r=upload(unlinked)
        assert not r['assetLinked'] and upload(unlinked,str(uuid.uuid4()))==r
        time.sleep(1)  # respect the fixture's normal burst limit
        try:
            upload(dict(a,feedback='changed'),str(uuid.uuid4()))
        except urllib.error.HTTPError as e:
            assert e.code==409 and json.load(e)['error']=='request_id_conflict'
        else: raise AssertionError('conflicting body was accepted')
        inv=request('/api/admin/device-assets'); assert len(inv['items'])==1 and inv['items'][0]['reports']==2
        assert inv['totals']['reports']==3 and inv['totals']['unassigned']==1
        counts=docker('exec',pg,'psql','-At','-U','postgres','-c','SELECT (SELECT count(*) FROM device_assets),(SELECT count(*) FROM asset_installations)')
        assert counts=='1|1', counts
        print('PASS: 4 concurrent retries -> 1 receipt; 2 linked samples -> 1 asset; no consent replay reassignment or orphan; conflicting body -> 409.')


if __name__=='__main__':
    main()
