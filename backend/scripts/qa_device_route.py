"""Capture a real app-context route experiment on an explicitly selected USB device."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time


def run(args):
    adb = [str(args.adb), '-s', args.serial]
    def shell(*command, check=True):
        return subprocess.run([*adb,'shell',*command], capture_output=True, text=True, timeout=8, check=check)
    def setting(name):
        return shell('settings','get','global',name).stdout.strip()
    wifi, mobile = setting('wifi_on'), setting('mobile_data')
    sim = shell('getprop','gsm.sim.state').stdout.strip().split(',')
    if wifi != '1' or mobile not in ('0','1') or not {'LOADED','READY'}.intersection(sim):
        raise SystemExit('Test requires enabled Wi-Fi, known mobile setting and a ready SIM. No setting was changed.')
    if mobile == '0' and not args.temporarily_enable_mobile_data:
        raise SystemExit('Mobile data is off. Enable manually or explicitly allow temporary activation.')
    marker='cache/sigmark-route-smoke-ready'
    payload='cache/sigmark-route-smoke.json'
    shell('run-as','com.sigmark.app','rm','-f',marker,payload)
    test = None
    try:
        test = subprocess.Popen([*adb,'shell','am','instrument','-w','-r','-e','route','wifi-cellular',
            'com.sigmark.app.test/com.sigmark.app.CapabilitySmoke'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,
            **({'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}))
        for _ in range(24):
            if shell('run-as','com.sigmark.app','cat',marker,check=False).stdout.strip()=='wifi':
                break
            if test.poll() is not None:
                raise RuntimeError(test.communicate()[0])
            time.sleep(.35)
        else:
            raise RuntimeError('No Wi-Fi start from test instrumentation.')
        if mobile=='0':
            shell('svc','data','enable')
        shell('svc','wifi','disable')
        log,_=test.communicate(timeout=40)
        if test.returncode or 'INSTRUMENTATION_CODE: -1' not in log:
            raise RuntimeError(log)
        data=subprocess.check_output([*adb,'exec-out','run-as','com.sigmark.app','cat',payload],timeout=8)
        report=json.loads(data)
        fields={(field['group'],field['key']):field for field in report['parameters']}
        assert fields['network','checkStartTransport']['value']=='wifi'
        assert fields['network','checkEndTransport']['value']=='cellular'
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_bytes(data)
        print(log.strip())
    finally:
        try:
            shell('svc','wifi','enable')
        finally:
            if mobile=='0':
                shell('svc','data','disable')
        if test and test.poll() is None:
            test.kill()
            test.communicate()
        shell('run-as','com.sigmark.app','rm','-f',marker,payload,check=False)
        if setting('wifi_on') != wifi or setting('mobile_data') != mobile:
            raise RuntimeError('Radio settings did not restore to their initial values; check the device.')
        print('Wi-Fi and mobile-data settings restored. No production upload.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb',default='adb')
    parser.add_argument('--serial',required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--temporarily-enable-mobile-data',action='store_true')
    run(parser.parse_args())
