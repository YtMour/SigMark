"""Real profile SQL/API regression, always in disposable containers. Optionally also runs browser QA."""
from argparse import ArgumentParser
from contextlib import ExitStack
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid

from qa_asset_uploads import docker, wait


def uid(): return str(uuid.uuid4())


def main(browser, image):
    name = 'sigmark-profile-' + uid()[:8]
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
                    '-e', 'LAN_BATCH=qa-profile', '-e', 'ADMIN_TOKEN=fixture', '-p', '127.0.0.1::8080',
                    image)
        base = 'http://' + docker('port', api, '8080/tcp')

        def get(path, auth=True):
            req = Request(base+path, headers={'Authorization':'Bearer fixture'} if auth else {})
            with urlopen(req, timeout=5) as response: return json.load(response)

        wait(lambda: get('/readyz'))
        def upload(version, parameters, asset_key=None, captured=None):
            coverage = {}
            for field in parameters:
                group = field['group']
                counts = coverage.setdefault(group,dict(group=group,available=0,restricted=0,unavailable=0,errors=0))
                counts[dict(AVAILABLE='available',RESTRICTED='restricted',UNAVAILABLE='unavailable',ERROR='errors')[field['status']]] += 1
            body = dict(schemaVersion=4, fieldSetVersion=version, requestId=uid(),
                        capturedAtEpochMs=captured or int(time.time()*1000), appVersion='1.0.0', collectorVersion='1.0.0',
                        model='Capability fixture', androidApi=29, network='wifi', wifiBand='unknown', radio='unknown',
                        metrics=[dict(key='system.selinux',status='RESTRICTED',reason='ACCESS_DENIED')],
                        parameters=parameters, coverage=list(coverage.values()))
            headers = {'X-SigMark-Client':'android-lan','Content-Type':'application/json'}
            if asset_key: headers['X-SigMark-Asset-Key'] = asset_key
            req = Request(base+'/api/v1/reports',data=json.dumps(body).encode(),headers=headers)
            with urlopen(req,timeout=5) as response: return json.load(response)

        capabilities = [dict(group=g,key=k,label=k,status='AVAILABLE',source='fixture',value=v) for g,k,v in [
            ('runtime','vulkanVersion','1.1.0'),('media','cameraCapabilitySummary','rear/FULL x1'),
            ('sensors','typeWakeupSummary','1:2/1')]]
        receipt = upload(8, capabilities)
        archived = get('/api/admin/reports/'+receipt['reportId'])['report']
        assert archived['fieldSetVersion']==8 and archived['parameters']==capabilities
        try: upload(7,capabilities)
        except HTTPError as e: assert e.code==400,e.code
        else: raise AssertionError('old field set accepted new keys')
        old = upload(7,[dict(group='runtime',key='openGlEs',label='openGlEs',status='AVAILABLE',source='fixture',value='3.2')])
        assert get('/api/admin/reports/'+old['reportId'])['report']['fieldSetVersion']==7
        print('PASS API: v8 upload and readback, v7 rejects v8 fields and accepts v7 fields.',flush=True)
        evidence = lambda outcome, location: [dict(group=g,key=k,label=k,status='AVAILABLE',source='fixture',value=v)
            for g,k,v in [('environment','capturePlan','rom'),('environment','captureLocationAccess',location),
                          ('media','avcFixture','sigmark-avc/1'),('media','avcFirstFrame',outcome),
                          ('media','avcStage','done' if outcome=='pass' else 'decode'),('media','avcElapsed','123 ms')]]
        at = int(time.time()*1000)
        asset_key = uid()
        baseline = upload(9,evidence('pass','precise'),asset_key,at-1000)['reportId']
        points = [dict(group='network',key=key,label=key,status='AVAILABLE',source='fixture',value=value)
                  for key,value in [('checkStartTransport','wifi'),('checkEndTransport','cellular'),('checkElapsed','2200 ms')]]
        status_pair = [dict(group='system',key='selinux',label='SELinux',source='/sys/fs/selinux/enforce',status='RESTRICTED',
                            value=None,reason='ACCESS_DENIED',errno=13)]
        current = upload(10,evidence('fail','approximate')+points+status_pair,asset_key,at)['reportId']
        assert get('/api/admin/reports/'+current)['report']['parameters']==evidence('fail','approximate')+points+status_pair
        try: upload(8,evidence('pass','precise'))
        except HTTPError as e: assert e.code==400,e.code
        else: raise AssertionError('v8 accepted v9 fields')
        time.sleep(.6)
        try: upload(9,points)
        except HTTPError as e: assert e.code==400,e.code
        else: raise AssertionError('v9 accepted v10 fields')
        dictionary = get('/api/admin/field-dictionary')
        duration = next(item for item in dictionary['items'] if item['key']=='media.avcElapsed')
        assert dictionary['latestFieldSet']==10 and duration==dict(key='media.avcElapsed',minSchemaVersion=4,sinceFieldSet=9,unit='ms')
        print('PASS API: field set 9, explicit test failure, old-version rejection, and field dictionary.',flush=True)
        sheet = get('/api/admin/reports/'+current+'/lab')
        assert sheet['current']['id']==current and [p['id'] for p in sheet['history']]==[baseline]
        assert not sheet['hasEarlier']
        # Only local fixture constants enter SQL. Set receipt times explicitly for deterministic boundary tests.
        assets = (uid(), uid(), uid())
        sql = ["INSERT INTO device_assets(id) VALUES " + ','.join("('%s')" % a for a in assets)]
        now = int(time.time()*1000)
        day = 86_400_000

        def row(asset, offset, attached=None, received=-1, trash=False):
            rid = uid()
            fields = [] if attached is None else [dict(group='app', key='debuggerConnected', label='debugger',
                                                      status='AVAILABLE', source='fixture', value=attached)]
            body = json.dumps(dict(capturedAtEpochMs=now+offset, model='same-test-model', parameters=fields))
            sql.append("INSERT INTO reports(id,batch,request_id,received_at,body,asset_id,trashed_at) "
                       "VALUES ('%s','qa-profile','%s',to_timestamp(%s/1000.0),'%s',%s,%s)" %
                       (rid, uid(), now+received, body, "'%s'" % asset if asset else 'NULL', 'now()' if trash else 'NULL'))
            return rid

        a,b,c = assets
        selected = row(a,0,'否',received=0)
        row(a,-30*day,'是')  # left edge included
        last = row(a,-2000,'是')
        row(a,-1500,'否'); row(a,-1000)  # missing evidence does not enter denominator
        row(a,-30*day-1,'是'); row(a,0,'是'); row(a,1,'是'); row(a,-3,'是',received=1)
        discarded = row(a,-4,'是',trash=True)
        row(b,-5,'是'); row(None,-7,'是')  # same model, different or unknown asset
        free = row(None,0,'是',received=0)
        exactly = row(c,0,'否',received=0)
        for i in range(1,51): row(c,-i,'是' if i==50 else '否')
        later = row(c,1,'是',received=1)
        subprocess.run(['docker','exec','-i',pg,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres'],
                       input=('BEGIN; '+'; '.join(sql)+'; COMMIT;').encode('utf-8'),check=True)

        def url(rid): return '/api/admin/reports/'+rid+'/device-profile'
        def profile(rid): return get(url(rid))
        def label(p, code): return next(l for l in p['labels'] if l['code']==code)
        p = profile(selected)
        assert (p['reportId'], p['ruleVersion'], p['linked'],p['historySamples'],p['historyLimited']) == (selected,'sigmark-profile/1',True,4,False),p
        dbg = label(p,'debugger_attached')
        assert (dbg['state'],dbg['historyHits'],dbg['historyEvaluable'],dbg['lastHistoricalHit']) == ('not_observed',2,3,{'id':last,'capturedAtEpochMs':now-2000}),dbg
        sel = label(p,'selinux_permissive'); assert sel['state']=='insufficient' and sel['historyEvaluable']==0 and 'lastHistoricalHit' not in sel
        p = profile(free); assert not p['linked'] and not p['historySamples'] and label(p,'debugger_attached')['state']=='hit'
        p = profile(exactly); assert p['historySamples']==50 and not p['historyLimited'] and label(p,'debugger_attached')['historyHits']==1
        p = profile(later); assert p['historySamples']==50 and p['historyLimited'] and label(p,'debugger_attached')['historyHits']==0 and label(p,'debugger_attached')['historyEvaluable']==50
        for rid,auth,status in [(selected,False,401),(discarded,True,404),(uid(),True,404),('invalid',True,400)]:
            try: get(url(rid), auth)
            except HTTPError as e: assert e.code==status,(e.code,status)
            else: raise AssertionError('expected rejection: '+str(status))
        old_sheet=get('/api/admin/reports/'+selected+'/lab')
        assert [p['report']['capturedAtEpochMs'] for p in old_sheet['history']]==[now-1000,now-1500,now-2000,now-30*day,now-30*day-1]
        capped=get('/api/admin/reports/'+later+'/lab')
        assert len(capped['history'])==12 and capped['hasEarlier']
        assert not get('/api/admin/reports/'+free+'/lab')['history']
        try: get('/api/admin/reports/'+discarded+'/lab')
        except HTTPError as e: assert e.code==404,e.code
        else: raise AssertionError('trashed report opened in lab')
        print('PASS lab snapshots: v10 points, scoped baseline, archive order, exclusions, and history limit.',flush=True)
        print('PASS PostgreSQL: asset isolation, unlinked, trash, timestamps, 30-day edge, 50/51, denominators, latest hit, API auth and errors.',flush=True)
        if browser:
            env = dict(os.environ, SIGMARK_QA_URL=base, SIGMARK_QA_TOKEN='fixture',
                       SIGMARK_QA_ACCEPTANCE_BASELINE=baseline, SIGMARK_QA_ACCEPTANCE_CURRENT=current)
            qa = Path(__file__).resolve().parents[1]/'web'/'qa'
            for script in ('device-profile.cjs','security-v7.cjs','acceptance.cjs','lab.cjs'):
                subprocess.run(['node',str(qa/script)],env=env,check=True)


if __name__=='__main__':
    parser=ArgumentParser(description=__doc__)
    parser.add_argument('--browser',action='store_true')
    parser.add_argument('--image',default='sigmark-qa:device-profile')
    args = parser.parse_args()
    main(args.browser,args.image)
