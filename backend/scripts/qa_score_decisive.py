"""End-to-end check of the decisive path through the real HTTP API.

The Go unit tests prove `score.go` caps the band on a decisive hit, but they call the
projection directly with a hand-built fixture. This script drives the deployed API
instead: take a real archived report's parameter list, rewrite it into an emulator with
almost everything unreadable, upload it, and read the score back through
`/api/admin/reports/{id}/device-profile`.

Using a real parameter list matters. `protocol.go` validates every group/key against a
versioned allowlist, so a hand-written fixture has to reproduce that allowlist exactly and
silently rots whenever a field set advances. Starting from a real report means the
fixture is valid by construction.

Two properties are checked, both of which the pre-fix code got wrong:
  1. A decisive hit caps the band at D even when overall coverage is below the floor.
     The old code took the low-coverage early return and published band "?" while also
     publishing `decisive: true` and a non-empty `caps` — one document contradicting
     itself.
  2. `value` stays null. Coverage withholds the number, not the conclusion.

Run against an isolated stack (LAN_BATCH=qa-score), never against the real library.
Usage:
    python scripts/qa_score_decisive.py --base http://127.0.0.1:2735 --token fixture
"""

import argparse
import json
import os
import time
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, 'testdata', 'emulator-template.json')

# Rewritten to an emulator build. Every key that is not listed here is forced to
# RESTRICTED, so the report answers almost nothing — the shape that used to slip through
# the low-coverage early return with a decisive hit in hand.
EMULATOR_VALUES = {
    'cpu.hardware': 'goldfish',
    'system.product': 'sdk_gphone_x86',
    'system.device': 'generic_x86',
    'system.model': 'sdk_gphone_x86',
    'system.propertyModel': 'sdk_gphone_x86',
    'system.propertyDevice': 'generic_x86',
}

# These keys must stay readable for the emulator markers to be derivable at all;
# everything else becomes unreadable, which is what drops coverage below the floor.
#
# `environment.capturePlan` is not a scoring input — it must stay AVAILABLE for the report
# to be *valid*. protocol.go's validTimedExperiment() cross-checks the plan against the
# timed-experiment rows (network.checkStartAt, media.avcStartAt, runtime.glesStartAt,
# runtime.usb*), and a real report carries those rows. Blanking the plan while the rows
# remain makes every upload fail with 400 invalid_report — found the hard way.
KEEP_READABLE = {'environment.capturePlan'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--token', required=True)
    parser.add_argument('--template', default=TEMPLATE)
    args = parser.parse_args()
    base = args.base.rstrip('/')
    auth = {'Authorization': 'Bearer ' + args.token}

    # utf-8-sig: PowerShell's Set-Content -Encoding utf8 writes a BOM on Windows.
    with open(args.template, encoding='utf-8-sig') as handle:
        template = json.load(handle)

    def get(path):
        request = Request(base + path, headers=auth)
        for attempt in range(4):
            try:
                with urlopen(request, timeout=10) as response:
                    return json.load(response)
            except HTTPError as error:
                if error.code != 429 or attempt == 3:
                    raise
                time.sleep(1)

    def upload(parameters, model='sdk_gphone_x86', api=34):
        coverage = {}
        statuses = dict(AVAILABLE='available', RESTRICTED='restricted',
                        UNAVAILABLE='unavailable', ERROR='errors')
        for field in parameters:
            group = field['group']
            counts = coverage.setdefault(group, dict(group=group, available=0,
                                                     restricted=0, unavailable=0, errors=0))
            counts[statuses[field['status']]] += 1
        body = dict(schemaVersion=4, fieldSetVersion=25, requestId=str(uuid.uuid4()),
                    capturedAtEpochMs=int(time.time() * 1000), appVersion='1.0.0',
                    collectorVersion='1.0.0', model=model, androidApi=api, network='wifi',
                    wifiBand='unknown', radio='unknown',
                    # protocol.go requires 1..6 metrics with a key from a fixed six-item
                    # list; an empty list is an invalid report.
                    metrics=[dict(key='system.selinux', status='RESTRICTED',
                                  reason='ACCESS_DENIED')],
                    parameters=parameters, coverage=list(coverage.values()))
        headers = {'X-SigMark-Client': 'android-lan', 'Content-Type': 'application/json',
                   # The asset key must be a lowercase UUID v4 (protocol.go requestPattern).
                   'X-SigMark-Asset-Key': str(uuid.uuid4())}
        request = Request(base + '/api/v1/reports', data=json.dumps(body).encode(),
                          headers=headers)
        try:
            with urlopen(request, timeout=10) as response:
                return json.load(response)['reportId']
        except HTTPError as error:
            print('upload rejected:', error.code,
                  error.read().decode('utf-8', 'replace'))
            raise

    emulator = []
    for row in template:
        key = row['group'] + '.' + row['key']
        out = dict(group=row['group'], key=row['key'], label=row['label'],
                   source=row['source'])
        if key in EMULATOR_VALUES:
            out['status'] = 'AVAILABLE'
            out['value'] = EMULATOR_VALUES[key]
        elif key in KEEP_READABLE:
            # Preserved verbatim so the timed-experiment cross-check still passes.
            out['status'] = row['status']
            if row.get('value') is not None:
                out['value'] = row['value']
        else:
            # Non-AVAILABLE rows must carry no value at all (protocol.go).
            out['status'] = 'RESTRICTED'
            out['reason'] = 'ACCESS_DENIED'
        emulator.append(out)

    report_id = upload(emulator)
    sheet = get('/api/admin/reports/' + report_id + '/device-profile')
    score = sheet['score']

    axes = {axis['code']: axis for axis in score['axes']}
    print('report', report_id)
    print('  band        =', score['band'])
    print('  value       =', score['value'])
    print('  coverage    =', score['coverage'])
    print('  decisive    =', score['decisive'])
    print('  caps        =', [cap['code'] for cap in score['caps']])
    for code in ('declaration', 'behavior', 'usage'):
        axis = axes[code]
        print('  %-11s score=%-5s coverage=%-5s deductions=%s'
              % (code, axis['score'], axis['coverage'],
                 [row['code'] for row in axis['deductions']]))

    failures = []
    # 1. The decisive hit must cap the band, low coverage or not.
    if not score['decisive']:
        failures.append('decisive is false: the emulator build markers did not fire')
    if not score['caps']:
        failures.append('caps is empty while decisive is true')
    if score['band'] != 'D':
        failures.append('band = %r, want D: a decisive hit must not be skipped by the '
                        'low-coverage early return' % (score['band'],))
    # 2. The number stays withheld — coverage is what withholds it.
    if score['value'] is not None:
        failures.append('value = %r, want null under R8' % (score['value'],))
    if score['coverage'] >= 0.5:
        failures.append('coverage = %r: this fixture needs to sit below the floor for the '
                        'regression to mean anything' % (score['coverage'],))
    # 3. The decisive deduction must be priced exactly once, in behavior.
    marker_axes = [code for code, axis in axes.items()
                   for row in axis['deductions'] if row['label'] == 'virtual_build_markers']
    if marker_axes != ['behavior']:
        failures.append('virtual_build_markers deducted on %r, want [behavior]'
                        % (marker_axes,))
    # 4. Every undetermined reason must stay inside the four field states.
    for gap in score['undetermined']:
        if gap['reason'] not in ('UNAVAILABLE', 'RESTRICTED', 'NOT_ARCHIVED', 'ERROR'):
            failures.append('undetermined reason %r is outside the four field states'
                            % (gap['reason'],))

    if failures:
        for failure in failures:
            print('FAIL', failure)
        raise SystemExit(1)
    print('PASS score: decisive hit caps the band at D under low coverage, value stays '
          'null, and the marker is priced exactly once.')


if __name__ == '__main__':
    main()
