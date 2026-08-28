#!/usr/bin/env python3
"""Round 11 verification — CHECK 5 (Q&A edit window) + CHECK 6 (edited flag). E2E against live dev server."""
import json, urllib.request, urllib.error, sys

BASE = 'http://localhost:3000'

def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw}

def login(email, password):
    _, d = call('POST', '/api/auth', {'action': 'login', 'email': email, 'password': password})
    return d['token']

CU = login('customer@medplus.com', 'Customer123!')
NU = login('nusrat@example.com', 'Customer123!')
PH = login('pharmacist@medplus.com', 'Pharma123!')
print('tokens ok (customer / nusrat / pharmacist)')

ORIG = 'Does the Digital BP Monitor come with different cuff sizes?'
NEW1 = 'Does the Digital BP Monitor include a large-cuff option in the box?'
NEW2 = 'Does the Digital BP Monitor include extra cuff sizes - large and small?'

_, d = call('GET', '/api/medicines?search=Digital%20BP')
BP_ID = [m for m in d['medicines'] if m['name'] == 'Digital BP Monitor'][0]['id']
print('BP_ID =', BP_ID)

print('--- CHECK 5a: POST question (owner, ACTIVE medicine) ---')
code, d = call('POST', '/api/questions', {'medicineId': BP_ID, 'question': ORIG}, CU)
assert code == 201, (code, d)
q = d['question']
QID = q['id']
assert q['status'] == 'PENDING' and q['answer'] is None and q['canEdit'] is True and q['helpfulCount'] == 0
print('PASS: 201, PENDING, canEdit true (fresh, in window), helpfulCount 0; qid =', QID)

print('--- CHECK 5b: GET rows visibility + canEdit ---')
code, d = call('GET', f'/api/questions?medicineId={BP_ID}', None, CU)
rows = d['questions']
mine = [x for x in rows if x['id'] == QID]
assert len(mine) == 1 and mine[0]['canEdit'] is True and mine[0]['status'] == 'PENDING'
assert all(x['canEdit'] is False for x in rows if x['status'] == 'ANSWERED')
assert all('userId' not in x and 'user' not in x for x in rows), 'userId leak'
print(f'PASS: owner sees PENDING row canEdit:true; {len(rows)} rows, no userId/user field anywhere')

code, d = call('GET', f'/api/questions?medicineId={BP_ID}')
rows_g = d['questions']
assert all(x['id'] != QID for x in rows_g), 'PENDING row leaked to guest'
assert all(x['canEdit'] is False for x in rows_g)
print(f'PASS: guest sees only ANSWERED rows ({len(rows_g)}), all canEdit:false')

code, d = call('GET', f'/api/questions?medicineId={BP_ID}', None, NU)
assert all(x['id'] != QID for x in d['questions']), 'PENDING row leaked to other user'
print('PASS: other authenticated user cannot see the PENDING row (no leak)')

code, d = call('GET', '/api/questions?mine=1', None, CU)
mine_rows = d['questions']
m1 = [x for x in mine_rows if x['id'] == QID][0]
assert m1['canEdit'] is True and m1['medicineName'] == 'Digital BP Monitor'
print('PASS: mine=1 row carries canEdit:true + medicineName')

print('--- CHECK 5c: PUT edit (owner) -> 200, text changed, shape == GET row ---')
code, d = call('PUT', '/api/questions', {'id': QID, 'question': NEW1}, CU)
assert code == 200, (code, d)
put_q = d['question']
assert put_q['question'] == NEW1
code, d = call('GET', f'/api/questions?medicineId={BP_ID}', None, CU)
get_q = [x for x in d['questions'] if x['id'] == QID][0]
assert set(put_q.keys()) == set(get_q.keys()), ('key diff', set(put_q.keys()) ^ set(get_q.keys()))
for k in put_q:
    assert put_q[k] == get_q[k], (k, put_q[k], get_q[k])
assert put_q['canEdit'] is True  # recomputed, still in window
print('PASS: text changed; PUT response keys/values EXACTLY match GET row:', sorted(put_q.keys()))

print('--- CHECK 5d: PUT again within window -> 200 ---')
code, d = call('PUT', '/api/questions', {'id': QID, 'question': NEW2}, CU)
assert code == 200 and d['question']['question'] == NEW2, (code, d)
print('PASS: second edit within window accepted:', code)

print('--- CHECK 5e: guards ---')
code, d = call('PUT', '/api/questions', {'id': QID, 'question': 'nusrat hijack attempt here'}, NU)
assert code == 403 and d['error'] == 'You can only edit your own questions', (code, d)
print('PASS: non-owner -> 403 exactly:', d)
code, d = call('PUT', '/api/questions', {'id': QID, 'question': 'guest attempt here ok'}, None)
assert code == 401, (code, d)
print('PASS: guest -> 401')
code, d = call('PUT', '/api/questions', {'id': 'does-not-exist-000', 'question': 'unknown id test here'}, CU)
assert code == 404 and d['error'] == 'Question not found', (code, d)
print('PASS: unknown id -> 404 exactly:', d)
code, d = call('PUT', '/api/questions', {'id': QID, 'question': 'abc'}, CU)
assert code == 400 and d['error'] == 'Question must be at least 5 characters', (code, d)
print('PASS: too short -> 400 exactly:', d)
code, d = call('PUT', '/api/questions', {'id': QID, 'question': 'x' * 601}, CU)
assert code == 400 and d['error'] == 'Question must be 600 characters or less', (code, d)
print('PASS: too long (601) -> 400 exactly:', d)
code, d = call('PUT', '/api/questions', {'id': QID, 'question': 'x' * 600}, CU)
assert code == 200, (code, d)
print('PASS: exactly 600 chars accepted (restored below)')

print('--- CHECK 5f: restore original text ---')
code, d = call('PUT', '/api/questions', {'id': QID, 'question': ORIG}, CU)
assert code == 200 and d['question']['question'] == ORIG, (code, d)
print('PASS: FINAL text restored to:', repr(d['question']['question']))

print('--- CHECK 6: pharmacist resource=questions -> edited flag ---')
code, d = call('GET', '/api/pharmacist?resource=questions&status=PENDING', None, PH)
rows = d['questions']
mine = [x for x in rows if x['id'] == QID]
assert len(mine) == 1, [x['id'] for x in rows]
qrow = mine[0]
assert qrow['edited'] is True, qrow
assert 'helpfulCount' in qrow and qrow['helpfulCount'] == 0
print('PASS: test question edited:true (edits bumped updatedAt), helpfulCount 0')
for x in rows:
    if x['id'] != QID:
        print(f"  other PENDING row {x['id'][:14]}… edited={x['edited']}")
print('ALL CHECK 5+6 ASSERTIONS PASSED')
print('TEST_QID=' + QID)
