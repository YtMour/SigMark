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


def main(browser, image, mobile_payloads):
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
            for attempt in range(4):
                try:
                    with urlopen(req, timeout=5) as response: return json.load(response)
                except HTTPError as error:
                    if error.code!=429 or attempt==3: raise
                    time.sleep(1)

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
        build_field = lambda name: dict(group='system',key='buildId',label='Build',source='Build.ID',status='AVAILABLE',value=name)
        baseline = upload(9,evidence('pass','precise')+[build_field('ROM-A'),
            dict(group='system',key='release',label='Android',source='fixture',status='AVAILABLE',value='10')],asset_key,at-1000)['reportId']
        points = [dict(group='network',key=key,label=key,status='AVAILABLE',source='fixture',value=value)
                  for key,value in [('checkStartTransport','wifi'),('checkEndTransport','cellular'),('checkElapsed','2200 ms')]]
        status_pair = [dict(group='system',key='selinux',label='SELinux',source='/sys/fs/selinux/enforce',status='RESTRICTED',
                            value=None,reason='ACCESS_DENIED',errno=13)]
        extra = [build_field('ROM-B'),
                 dict(group='battery',key='energyCounter',label='Energy',source='BatteryManager',status='UNAVAILABLE',value=None,reason='INTERFACE_UNSUPPORTED'),
                 dict(group='memory',key='availableRam',label='RAM',source='ActivityManager',status='ERROR',value=None,reason='READ_FAILED')]
        observation = [dict(group=g,key=k,label=k,status='AVAILABLE',source='fixture',value=v) for g,k,v in [
            ('cpu','processBitness','32'),('cpu','kernelMachine','aarch64'),
            ('system','interfaceCapabilities','gnss / usb_host'),('runtime','externalInputTypes','none')]]
        hardware = [dict(group=g,key=k,label=k,status='AVAILABLE',source='fixture',value=v) for g,k,v in [
            ('system','gnssHardwareYear','2018'),('system','gnssCapabilities','measurements'),
            ('runtime','declaredInput','touchscreen'),('runtime','glesProbeResult','pass'),('runtime','glesProbeVersion','3.2'),
            ('runtime','glesProbeStage','done'),('media','cameraModes','raw / high_speed_video'),
            ('sensors','reportingModes','1/2/0/0/0'),('sensors','fifoCount','1'),('sensors','directChannelTypes','none')]]
        current_fields = evidence('fail','approximate')+points+status_pair+extra+observation+hardware
        current = upload(12,current_fields,asset_key,at)['reportId']
        assert get('/api/admin/reports/'+current)['report']['parameters']==current_fields
        try: upload(8,evidence('pass','precise'))
        except HTTPError as e: assert e.code==400,e.code
        else: raise AssertionError('v8 accepted v9 fields')
        time.sleep(.6)
        try: upload(9,points)
        except HTTPError as e: assert e.code==400,e.code
        else: raise AssertionError('v9 accepted v10 fields')
        time.sleep(.6)
        try: upload(10,observation)
        except HTTPError as e: assert e.code==400,e.code
        else: raise AssertionError('v10 accepted v11 fields')
        time.sleep(.6)
        try: upload(11,hardware)
        except HTTPError as e: assert e.code==400,e.code
        else: raise AssertionError('v11 accepted v12 fields')
        dictionary = get('/api/admin/field-dictionary')
        duration = next(item for item in dictionary['items'] if item['key']=='media.avcElapsed')
        bits = next(item for item in dictionary['items'] if item['key']=='cpu.processBitness')
        assert dictionary['latestFieldSet']==20 and dictionary['dictionaryVersion']=='sigmark-lan-fields/11'
        assert (duration['unit'], duration['sinceFieldSet'], duration['plan'], duration['temporal'])==('ms',9,'rom','experiment')
        assert duration['alsoPlans']==['full']
        assert (bits['unit'],bits['sinceFieldSet'],bits['valueKind'],bits['scope'])==('bit',11,'integer_text','lan_projection')
        cell = next(item for item in dictionary['items'] if item['key']=='cellular.cellLTEBandwidth')
        assert cell['minApi']==28 and cell['requires']==['android.permission.ACCESS_FINE_LOCATION','system_location_enabled']
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
                                                      status='AVAILABLE', source='fixture', value=attached),
                                                  dict(group='environment', key='tracerPid', label='tracer',
                                                      status='AVAILABLE', source='/proc/self/status', value='0')]
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
        other_asset = row(b,-5,'是'); row(None,-7,'是')  # same model, different or unknown asset
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
        assert (p['reportId'], p['ruleVersion'], p['linked'],p['historySamples'],p['historyLimited']) == (selected,'sigmark-profile/3',True,4,False),p
        assert [l['code'] for l in p['labels']]==['virtual_build_markers','selinux_permissive','debugger_attached',
            'hook_injection','root_manager_visible','multi_open','rom_verification','software_drm','identity_conflict'],p
        assert all('historyRestricted' in l for l in p['labels']),p
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
        def register(report_id, name):
            req = Request(base+'/api/admin/regression-baselines',data=json.dumps(dict(
                reportId=report_id,name=name,expectUnlock=True,expectedNetwork='wifi')).encode(),headers={
                'Authorization':'Bearer fixture','X-SigMark-Admin':'1','Content-Type':'application/json'})
            with urlopen(req,timeout=5) as response: return json.load(response)['id']

        named = register(baseline,'ROM baseline')
        foreign = register(other_asset,'Other device')
        # The selected c sample has >50 previous entries. Its oldest registered
        # reference should still be selectable, without dropping history.
        oldest_id = row(c,-90000,'否',received=-90000)
        subprocess.run(['docker','exec','-i',pg,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres'],
                       input=(sql[-1]+';').encode('utf-8'),check=True)
        older = register(oldest_id,'Older than ordinary history')
        named_sheet = get('/api/admin/reports/'+current+'/lab?saved='+named)
        assert [r['id'] for r in named_sheet['registeredBaselines']]==[named]
        assert named_sheet['registeredReport']['id']==baseline
        assert not get('/api/admin/reports/'+current+'/lab?saved='+foreign).get('registeredReport')
        assert all(r['id']!=oldest_id for r in capped['history'])
        assert get('/api/admin/reports/'+later+'/lab?saved='+older)['registeredReport']['id']==oldest_id
        print('PASS registered baseline: same asset only, older than normal history, named metadata and selected body.',flush=True)
        print('PASS PostgreSQL: asset isolation, unlinked, trash, timestamps, 30-day edge, 50/51, denominators, latest hit, API auth and errors.',flush=True)
        asset = sheet['current']['assetId']
        dossier_url = lambda id: '/api/admin/device-assets/'+id+'/dossier'
        newest_other_asset = upload(10,[build_field('Different asset')],uid(),at+1000)['reportId']
        assert newest_other_asset != current
        time.sleep(.6)
        delayed = upload(9,[build_field('ROM-A uploaded late')],asset_key,at-2000)['reportId']
        assert get('/api/admin/reports/'+delayed)['receivedAt'] > sheet['current']['receivedAt']
        dossier = get(dossier_url(asset))
        assert (dossier['reportId'],dossier['buildId'],dossier['fieldSetVersion'])==(current,'ROM-B',12),dossier
        assert 'android' not in dossier and len(dossier['categories'])==12
        by_group = {group['group']:group for group in dossier['categories']}
        assert by_group['system']['counts']['restricted']==1
        assert by_group['battery']['counts']['unavailable']==1 and by_group['memory']['counts']['errors']==1
        assert by_group['cellular']['checklistScope']==0
        assert next(g for g in by_group['system']['gaps'] if g['key']=='release')['code']=='NOT_RECORDED'
        assert next(f for f in by_group['system']['fields'] if f['key']=='selinux')['errno']==13
        assert get(dossier_url(b))['reportId']!=current
        # Another isolated asset: newest by capture may be in trash; the live
        # version falls back without consulting any similarly named devices.
        trash_latest = get(dossier_url(c))
        assert trash_latest['reportId']==later
        subprocess.run(['docker','exec',pg,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres','-c',
                        "UPDATE reports SET trashed_at=now() WHERE id='%s'" % later],check=True)
        assert get(dossier_url(c))['reportId']==exactly
        for rid,auth,status in [(asset,False,401),(uid(),True,404),('invalid',True,400)]:
            try: get(dossier_url(rid),auth)
            except HTTPError as e: assert e.code==status,(e.code,status)
            else: raise AssertionError('expected dossier rejection: '+str(status))
        print('PASS dossier API: isolated exact assets, delayed upload, cross-ROM, 12 categories, restricted/no value/error, no inherited evidence, trash and auth.',flush=True)
        # GNSS report stays reachable after a newer standard capture of the
        # same asset. All rows in this check are synthetic (no location data).
        gnss_key = uid()
        gnss_at = int(time.time()*1000)
        field = lambda g,k,v:dict(group=g,key=k,label=k,status='AVAILABLE',source='fixture',value=v)
        gnss_fields = [field('environment','capturePlan','gnss')]
        gnss_fields += [field('system',key,value) for key,value in [
            ('gnssHardwareYear','0'),('gnssProvider','yes'),('interfaceCapabilities','gnss'),('gnssCapabilities','measurements'),
            ('gnssCheckPrerequisite','ready'),('gnssCheckStatus','observed'),('gnssCheckMeasurements','observed'),
            ('gnssCheckStartAt',str(gnss_at-200)),('gnssCheckEndAt',str(gnss_at-100)),('gnssCheckElapsed','100 ms')]]
        time.sleep(.6)
        gnss_id = upload(14,gnss_fields,gnss_key,gnss_at)['reportId']
        gnss_asset = get('/api/admin/reports/'+gnss_id+'?include=asset')['assetId']
        time.sleep(.6)
        standard_id = upload(14,[field('environment','capturePlan','standard'),field('system','gnssHardwareYear','2016')],
                             gnss_key,gnss_at+100)['reportId']
        gnss_dossier = get(dossier_url(gnss_asset))
        assert gnss_dossier['reportId']==standard_id and gnss_dossier['latestGnssReportId']==gnss_id
        assert get('/api/admin/reports/'+gnss_id)['report']['parameters']==gnss_fields
        assert 'latestGnssReportId' not in get(dossier_url(asset)), 'GNSS experiment leaked across assets'
        print('PASS GNSS v14: documented raw zero, synthetic callbacks, newer standard sample and latest same-asset GNSS reference.',flush=True)
        cfg = [
            ('system','brand','Brand'),('system','model','Model'),('system','device','fixture'),
            ('cpu','abis','arm64-v8a'),('system','type','user'),('system','buildId','QA1A'),
            ('system','patch','2026-10-01'),('cpu','cores','4'),('battery','temperature','35.2 °C')]
        technical = [field(*row) for row in cfg]
        for group,key,value,path in [
            ('cpu','sysCpuPossible','0-7','/sys/devices/system/cpu/possible'),
            ('cpu','sysCpuOnline','0-3','/sys/devices/system/cpu/online'),
            ('battery','sysBatteryTemp','350','/sys/class/power_supply/battery/temp')]:
            technical.append({**field(group,key,value),'source':path})
        cfg_key = uid()
        cfg_at = int(time.time()*1000)
        time.sleep(.6)
        cfg_old = upload(15,technical+[field('system','incremental','1')],cfg_key,cfg_at-1000)['reportId']
        time.sleep(.6)
        cfg_new = upload(15,technical+[field('system','incremental','2')],cfg_key,cfg_at)['reportId']
        cfg_asset = get('/api/admin/reports/'+cfg_new+'?include=asset')['assetId']
        cfg_dossier = get(dossier_url(cfg_asset))['configurationCode']
        assert cfg_dossier['previousReportId']==cfg_old
        assert cfg_dossier['version']=='sigmark-config-code/2'
        components={part['domain']:part for part in cfg_dossier['components']}
        assert set(components)=={'product','hardware','rom'}
        assert components['product']['code'].startswith('P2-')
        assert not components['hardware'].get('code'), 'v15 fixture is missing hardware inputs'
        assert components['rom']['code'].startswith('R2-')
        assert {v['key']:v['change'] for v in components['rom']['inputs'] if v.get('change')}=={'system.incremental':'changed'}
        print('PASS configuration v15: same-asset predecessor, ROM delta, raw sysfs/API archive and versioned code components.',flush=True)
        ids, route_reports, usb_reports = [], [], []
        for sample in mobile_payloads:
            payload = Path(sample).read_bytes()
            original = json.loads(payload)
            assert (original['fieldSetVersion'],original['appVersion']) in [(12,'1.3.0'),(13,'1.4.0'),(13,'1.4.1')]
            source = {(p['group'],p['key']):p.get('value') for p in original['parameters']}
            is_route = source.get(('environment','capturePlan'))=='network'
            is_usb = source.get(('environment','capturePlan'))=='usb'
            if is_route:
                assert source.get(('network','checkStartTransport'))=='wifi' and source.get(('network','checkEndTransport'))=='cellular'
            elif is_usb:
                assert source.get(('runtime','usbOutcome')) in ('increase','decrease','no_change','incomplete')
                assert source.get(('runtime','usbStartAt')) and source.get(('runtime','usbEndAt'))
            else:
                assert source.get(('runtime','glesProbeResult'))=='pass'
            time.sleep(.6)
            req = Request(base+'/api/v1/reports',data=payload,headers={
                'X-SigMark-Client':'android-lan','Content-Type':'application/json','X-SigMark-Asset-Key':uid()})
            with urlopen(req,timeout=5) as response: saved_id=json.load(response)['reportId']
            if is_route: route_reports.append((saved_id,source.get(('network','checkEndValidated'))=='yes'))
            elif is_usb: usb_reports.append((saved_id,source[('runtime','usbOutcome')]))
            else: ids.append((saved_id,original['fieldSetVersion']))
            archived = get('/api/admin/reports/'+saved_id)['report']
            assert {(p['group'],p['key']):p for p in archived['parameters']} == {
                (p['group'],p['key']):{k:v for k,v in p.items() if k not in {'reason','errno','note'} or v is not None}
                for p in original['parameters']}
            print('PASS real APK projection → isolated PostgreSQL → report API:',original['model'],len(archived['parameters']),flush=True)
        if browser:
            env = dict(os.environ, SIGMARK_QA_URL=base, SIGMARK_QA_TOKEN='fixture',
                       SIGMARK_QA_ACCEPTANCE_BASELINE=baseline, SIGMARK_QA_ACCEPTANCE_CURRENT=current,
                       SIGMARK_QA_DOSSIER_ASSET=asset,SIGMARK_QA_REGISTERED_BASELINE=named,
                       SIGMARK_QA_GNSS_ASSET=gnss_asset,SIGMARK_QA_GNSS_REPORT=gnss_id,
                       SIGMARK_QA_CONFIG_ASSET=cfg_asset,SIGMARK_QA_CONFIG_PREVIOUS=cfg_old)
            qa = Path(__file__).resolve().parents[1]/'web'/'qa'
            for script in ('device-profile.cjs','security-v7.cjs','acceptance.cjs','lab.cjs','risk-assessment.cjs','device-dossier.cjs','report-reader.cjs','gnss-audit.cjs','configuration-evidence.cjs'):
                subprocess.run(['node',str(qa/script)],env=env,check=True)
            for id,version in ids or [(current,12)]:
                subprocess.run(['node',str(qa/'hardware-capture.cjs'),id,str(version)],env=env,check=True)
            for id,validated in route_reports:
                subprocess.run(['node',str(qa/'verification-route.cjs'),id,'yes' if validated else 'no'],env=env,check=True)
            for id,outcome in usb_reports:
                subprocess.run(['node',str(qa/'verification-usb.cjs'),id,outcome],env=env,check=True)

        # Rehearse an actual PostgreSQL restore only inside the disposable
        # database host; a report/derived JSON export is not a backup.
        name='verification_restore'
        query='SELECT count(*) FROM reports; SELECT count(*) FROM regression_baselines;'
        count=lambda db:docker('exec',pg,'psql','-XAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db,'-c',query)
        expected=count('postgres')
        docker('exec',pg,'pg_dump','-Fc','-U','postgres','-d','postgres','-f','/tmp/verification.qa.dump')
        docker('exec',pg,'createdb','-U','postgres',name)
        docker('exec',pg,'pg_restore','--exit-on-error','-U','postgres','-d',name,'/tmp/verification.qa.dump')
        assert count(name)==expected
        assert docker('exec',pg,'psql','-XAt','-U','postgres','-d',name,'-c',
                      "SELECT b.report_id FROM regression_baselines b JOIN reports r ON r.id=b.report_id WHERE b.id='%s'" % named)==baseline
        print('PASS disposable PostgreSQL dump/restore: report/baseline counts and registered reference preserved.',flush=True)


if __name__=='__main__':
    parser=ArgumentParser(description=__doc__)
    parser.add_argument('--browser',action='store_true')
    parser.add_argument('--image',default='sigmark-qa:device-profile')
    parser.add_argument('--mobile-payload',action='append',default=[],help='APK fixture JSON, posted only to the disposable database.')
    args = parser.parse_args()
    main(args.browser,args.image,args.mobile_payload)
