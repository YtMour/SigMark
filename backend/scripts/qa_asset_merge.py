"""Exercise guarded merge and undo against disposable PostgreSQL; never the live LAN."""
import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from qa_asset_uploads import docker, wait


def main(image, browser):
    network = 'sigmark-merge-qa-' + uuid.uuid4().hex[:10]
    with ExitStack() as stack:
        docker('network','create',network)
        stack.callback(docker,'network','rm',network)
        def start(*args):
            cid=docker('run','-d','--rm','--network',network,*args)
            stack.callback(docker,'stop','-t','1',cid)
            return cid
        pg=start('--name',network+'-pg','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD=fixture','postgres:17-alpine')
        wait(lambda:docker('exec',pg,'pg_isready','-U','postgres'))
        api=start('-e','DATABASE_URL=postgres://postgres:fixture@'+network+'-pg/postgres?sslmode=disable',
                  '-e','ADMIN_TOKEN=fixture','-e','REPOSITORY_READ_TOKEN=fixture-warehouse-reader-01',
                  '-e','LAN_BATCH=qa-merge','-p','127.0.0.1::8080',image)
        base='http://'+docker('port',api,'8080/tcp')
        def request(path,body=None,headers=None,status=200):
            if headers is None: headers={'Authorization':'Bearer fixture','X-SigMark-Admin':'1'}
            data=None if body is None else json.dumps(body).encode()
            if data is not None: headers={**headers,'Content-Type':'application/json'}
            req=urllib.request.Request(base+path,data=data,headers=headers)
            try:
                with urllib.request.urlopen(req,timeout=8) as response:
                    assert response.status==status,(path,response.status)
                    return json.load(response)
            except urllib.error.HTTPError as err:
                if err.code==429: # Fixture API uses normal limits.
                    time.sleep(.7)
                    return request(path,body,headers,status)
                assert err.code==status,(path,err.code,err.read())
                return json.load(err)
        wait(lambda:request('/readyz'))
        admin='/api/admin'
        merge=admin+'/device-assets'
        def upload(model,key):
            return request('/api/v1/reports',dict(requestId=str(uuid.uuid4()),schemaVersion=4,fieldSetVersion=13,
                appVersion='1.4.0',collectorVersion='1.4.0',capturedAtEpochMs=int(time.time()*1000),model=model,
                androidApi=29,network='wifi',wifiBand='5',radio='unknown',
                metrics=[dict(key='system.selinux',status='RESTRICTED',reason='ACCESS_DENIED')],
                parameters=[dict(group='system',key='patch',label='patch',value='2026-07-05',status='AVAILABLE',source='fixture')],
                coverage=[dict(group='system',available=1,restricted=0,unavailable=0,errors=0)]),
                {'X-SigMark-Client':'android-lan','X-SigMark-Asset-Key':key},201)['reportId']
        def detail(id):return request(admin+'/reports/'+id+'?include=asset')
        sa,sb=[str(uuid.uuid4()) for _ in range(2)]
        first,trash,target=upload('Merge source',sa),upload('Merge source',sa),upload('Merge target',sb)
        a,b=detail(first)['assetId'],detail(target)['assetId']
        viewer={'Authorization':'Bearer fixture-warehouse-reader-01','X-SigMark-Admin':'1'}
        assert request(admin+'/reports/'+first,headers=viewer)['id']==first
        assert request(merge+'/merges',headers=viewer,status=403)['error']=='read_only_token'
        assert request(merge+'/merge',{},headers=viewer,status=403)['error']=='read_only_token'
        request(admin+'/regression-baselines',dict(name='Merge fixture',reportId=first,expectUnlock=False),status=201)
        def move(action): return request(admin+'/reports/manage',dict(ids=[trash],action=action))
        def preview():return request(merge+'/merge-preview?'+urllib.parse.urlencode(dict(source=a,target=b)))
        def combine(p,status=200):
            return request(merge+'/merge',dict(source=a,target=b,confirmed=True,previewToken=p),status=status)
        def undo(id,status=200):return request(merge+'/merges/'+id+'/undo',{'confirmed':True},status=status)
        assert combine('',400)['error']=='asset_merge_preview_required'
        move('trash')
        p=preview()
        assert p['source']['reports']==1 and p['source']['trashed']==1 and p['source']['baselines']==1 and p['source']['installations']==1
        move('restore')
        assert combine(p['previewToken'],409)['error']=='asset_merge_preview_changed'
        assert detail(first)['assetId']==a
        move('trash')
        merged=combine(preview()['previewToken'])['operationId']
        item=request(merge+'/merges')['items'][0]
        assert item['id']==merged and item['state']=='eligible'
        assert 'installDigests' not in item and 'reportIds' not in item
        assert detail(first)['assetId']==b and detail(trash)['trashedAt']
        move('restore')
        assert undo(merged)['assetId']==a
        assert undo(merged,409)['error']=='asset_merge_undo_unavailable'
        assert detail(trash)['assetId']==a and not detail(trash).get('trashedAt')
        assert request(admin+'/regression-baselines')['items'][0]['reportId']==first
        assert detail(upload('Merge source',sa))['assetId']==a
        print('PASS preview stale, trash and baseline impact, raw report identity preserved, provenance-scoped undo and installation restored.',flush=True)
        if browser:
            env=dict(os.environ,SIGMARK_QA_URL=base,SIGMARK_QA_TOKEN='fixture',SIGMARK_QA_MERGE_SOURCE=a,SIGMARK_QA_MERGE_TARGET=b)
            subprocess.run(['node',str(Path(__file__).resolve().parents[1]/'web'/'qa'/'asset-merge.cjs')],env=env,check=True)
        merged=combine(preview()['previewToken'])['operationId']
        post=upload('Merge source',sa)
        assert detail(post)['assetId']==b
        assert undo(merged,409)['error']=='asset_merge_membership_changed'
        assert detail(first)['assetId']==b and detail(post)['assetId']==b
        docker('exec',pg,'psql','-Xq','-v','ON_ERROR_STOP=1','-U','postgres','-c',
            "UPDATE asset_merge_operations SET created_at=now()-interval '25 hours' WHERE id='%s'" % merged)
        assert undo(merged,409)['error']=='asset_merge_undo_unavailable'
        assert next(item for item in request(merge+'/merges')['items'] if item['id']==merged)['state']=='expired'
        print('PASS subsequent uploads prevent stale undo, expiration enforced, no reports deleted.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image',required=True)
    parser.add_argument('--browser',action='store_true')
    args=parser.parse_args()
    main(args.image,args.browser)
