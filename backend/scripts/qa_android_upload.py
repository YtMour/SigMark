"""Test the real Android uploader through ADB reverse against disposable containers."""
import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request
import uuid

from qa_asset_uploads import docker, wait


def run(args):
    adb = [args.adb, '-s', args.serial]
    network = 'sigmark-android-qa-' + uuid.uuid4().hex[:10]
    with ExitStack() as stack:
        docker('network', 'create', network)
        stack.callback(docker, 'network', 'rm', network)

        def start(*command):
            cid = docker('run', '-d', '--rm', '--network', network, *command)
            stack.callback(docker, 'stop', '-t', '1', cid)
            return cid

        pg = start('--name', network+'-pg', '--tmpfs', '/var/lib/postgresql/data',
                   '-e', 'POSTGRES_PASSWORD=fixture', 'postgres:17-alpine')
        wait(lambda: docker('exec', pg, 'pg_isready', '-U', 'postgres'))
        api = start('-e', 'DATABASE_URL=postgres://postgres:fixture@'+network+'-pg/postgres?sslmode=disable',
                    '-e', 'ADMIN_TOKEN=fixture', '-e', 'LAN_BATCH=qa-phone-wire', '-p', '127.0.0.1::8080', args.image)
        host = docker('port', api, '8080/tcp')
        port = host.rsplit(':',1)[1]

        def get(path):
            req = urllib.request.Request('http://'+host+path,headers={'Authorization':'Bearer fixture'})
            with urllib.request.urlopen(req,timeout=6) as response:
                return json.load(response)

        wait(lambda: get('/readyz'))
        # Do not displace any ADB reverse mapping already used by the owner.
        tcp = 'tcp:'+port
        subprocess.run([*adb,'reverse','--no-rebind',tcp,tcp],check=True,timeout=8)
        stack.callback(subprocess.run,[*adb,'reverse','--remove',tcp],check=True,timeout=8)
        log = subprocess.check_output([*adb,'shell','am','instrument','-w','-r','-e','isolatedUploadPort',port,
             ('com.sigmark.app.qa.test' if args.isolated_package else 'com.sigmark.app.test')+
             '/com.sigmark.app.CapabilitySmoke'],text=True,encoding='utf-8',errors='replace',timeout=70)
        if 'INSTRUMENTATION_CODE: -1' not in log:
            raise RuntimeError(log)
        ids=re.search(r'^INSTRUMENTATION_RESULT: reportIds=([0-9a-f,-]+)$',log,re.M)
        if not ids:
            raise RuntimeError(log)
        first, second = ids[1].split(',')
        def report(id):
            return get('/api/admin/reports/'+id+'?include=asset')
        a,b=report(first),report(second)
        assert a['id']!=b['id'] and a['assetId'] and a['assetId']==b['assetId']
        assert all(r['batch']=='qa-phone-wire' and r['report']['fieldSetVersion']==20 for r in (a,b))
        assert b['report']['capturedAtEpochMs'] > a['report']['capturedAtEpochMs']
        fields={(p['group'],p['key']):p for p in a['report']['parameters']}
        for archived in (a, b):
            evidence={(p['group'],p['key']):p for p in archived['report']['parameters']}
            assert evidence['environment','capturePlan']['value']=='full'
            assert evidence['media','avcFirstFrame']['value']=='pass'
            assert evidence['runtime','glesProbeResult']['value']=='pass'
            for group,start,end in [('media','avcStartAt','avcEndAt'),('runtime','glesStartAt','glesEndAt')]:
                assert 0 < int(evidence[group,start]['value']) <= int(evidence[group,end]['value'])
        assert fields['battery','present']['source']=='BatteryManager.EXTRA_PRESENT'
        assert fields['battery','cycleCount']['source']=='BatteryManager.EXTRA_CYCLE_COUNT'
        assert fields['system','bootCount']['source']=='Settings.Global.BOOT_COUNT'
        assert fields['system','mediaPerformanceClass']['source']=='Build.VERSION.MEDIA_PERFORMANCE_CLASS'
        for key in ('dataSubscriptionService','carrierBandwidths'):
            assert fields['cellular',key]['source'].startswith('TelephonyManager.')
        for group,key in [('battery','present'),('battery','cycleCount'),('cellular','dataSubscriptionService'),('cellular','carrierBandwidths')]:
            row=fields[group,key]
            print(f"{a['report']['model']}: {group}.{key} {row['status']} {row.get('value') or row.get('reason') or ''}")
        for group,key,path in [
            ('cpu','sysCpuOnline','/sys/devices/system/cpu/online'),
            ('cpu','sysCpuPossible','/sys/devices/system/cpu/possible'),
            ('battery','sysBatteryTemp','/sys/class/power_supply/battery/temp')]:
            row=fields[group,key]
            allowed_sources={path}
            if key=='sysBatteryTemp':
                allowed_sources.add('/sys/class/power_supply/bms/temp')
            assert row['source'] in allowed_sources and (row['value'] is not None)==(row['status']=='AVAILABLE'),row
        dossier=get('/api/admin/device-assets/'+a['assetId']+'/dossier')
        assert dossier['configurationCode']['version']=='sigmark-config-code/2'
        assert {part['domain'] for part in dossier['configurationCode']['components']}=={'product','hardware','rom'}
        assert dossier['configurationCode']['previousReportId']==a['id']
        inventory=get('/api/admin/device-assets')
        assert inventory['totals']['reports']==2 and inventory['totals']['devices']==1
        assert inventory['items'][0]['reports']==2
        if args.browser:
            env = dict(os.environ, SIGMARK_QA_URL='http://'+host, SIGMARK_QA_TOKEN='fixture',
                       SIGMARK_QA_REPORT=first)
            subprocess.run(['node', str(Path(__file__).resolve().parents[1] / 'web/qa/portable-fields.cjs')],
                           env=env, check=True, timeout=35)
        print(f"PASS actual Android upload: {a['report']['model']} · {len(a['report']['parameters'])} fields, AVC/GLES passed in both captures; 1 asset and retry reused receipt.")


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial',required=True)
    parser.add_argument('--image',required=True)
    parser.add_argument('--adb',default='adb')
    parser.add_argument('--isolated-package',action='store_true',help='Use the com.sigmark.app.qa installation and instrumentation.')
    parser.add_argument('--browser',action='store_true',help='Read and export the phone report with headless Chromium.')
    run(parser.parse_args())
