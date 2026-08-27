import json, urllib.request, urllib.error

BASE = 'http://localhost:3000'

def call(path, method='GET', body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    if token: req.add_header('Authorization', 'Bearer ' + token)
    data = None
    if body is not None:
        req.add_header('Content-Type', 'application/json')
        data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try: payload = json.loads(e.read().decode())
        except Exception: payload = None
        return e.code, payload

def login(email, pw):
    st, d = call('/api/auth', 'POST', {'action': 'login', 'email': email, 'password': pw})
    assert st == 200, f'login {email}: {st}'
    return d['token']

ctok = login('customer@medplus.com', 'Customer123!')
ptok = login('pharmacist@medplus.com', 'Pharma123!')
print('logins OK')

# 1. pharmacist ANSWERED rows carry helpfulCount
st, d = call('/api/pharmacist?resource=questions&status=ANSWERED', token=ptok)
assert st == 200
counts = {q['question'][:40]: q['helpfulCount'] for q in d['questions']}
assert all('helpfulCount' in q for q in d['questions'])
print('pharmacist ANSWERED helpfulCounts:', json.dumps(counts, indent=0))
seclo_q = next(q for q in d['questions'] if q['question'].startswith('Should Seclo be taken before meals'))
spacing_q = next(q for q in d['questions'] if q['question'].startswith('How many hours should I wait'))
QID, N0 = seclo_q['id'], seclo_q['helpfulCount']
QID2, N1 = spacing_q['id'], spacing_q['helpfulCount']

# 2. Vitamin C medicine id
st, d = call('/api/medicines?search=vitamin')
assert st == 200 and d['medicines'], f'medicines search: {st}'
MID = d['medicines'][0]['id']
print('Vitamin C med:', MID)

# 3. create a PENDING question as customer (also demo data for pending UI)
st, d = call('/api/questions', 'POST', {'medicineId': MID, 'question': 'Can I take Vitamin C together with antibiotics?'}, ctok)
assert st == 201 and d['question']['status'] == 'PENDING', f'create question: {st} {d}'
PENDID = d['question']['id']
print('created PENDING question:', PENDID)

# 4. toggle tests (two calls = one full flip cycle; final state == initial state == seeded state)
def flip_cycle(qrow, label):
    qid, n0 = qrow['id'], qrow['helpfulCount']
    # current caller state via public listing (hasVoted)
    st, d = call(f"/api/questions?medicineId={qrow['medicineId']}", token=ctok)
    assert st == 200
    row = next(r for r in d['questions'] if r['id'] == qid)
    v0 = bool(row.get('hasVoted'))
    exp1 = n0 - 1 if v0 else n0 + 1
    st, d = call('/api/questions/helpful', 'POST', {'questionId': qid}, ctok)
    assert st == 200 and d == {'questionId': qid, 'helpfulCount': exp1, 'voted': (not v0)}, d
    print(f'{label}: toggle #1 -> {d} (was count={n0}, hasVoted={v0})')
    st, d = call('/api/questions/helpful', 'POST', {'questionId': qid}, ctok)
    assert st == 200 and d == {'questionId': qid, 'helpfulCount': n0, 'voted': v0}, d
    print(f'{label}: toggle #2 -> {d} (restored: count={n0}, hasVoted={v0})')

flip_cycle(seclo_q, 'Seclo-timing (customer seeded vote)')
flip_cycle(spacing_q, 'Dose-spacing (no customer vote)')

# 5. guards
st, d = call('/api/questions/helpful', 'POST', {'questionId': QID})
assert st == 401, st
print('unauthenticated -> 401 OK')
st, d = call('/api/questions/helpful', 'POST', {'questionId': PENDID}, ctok)
assert st == 400 and d['error'] == 'Only answered questions can receive votes', (st, d)
print('on PENDING -> 400 "Only answered questions can receive votes" OK')
st, d = call('/api/questions/helpful', 'POST', {'questionId': 'nope'}, ctok)
assert st == 404, st
print('unknown question -> 404 OK')
st, d = call('/api/questions/helpful', 'POST', {}, ctok)
assert st == 400, st
print('missing questionId -> 400 OK')

# 6. customer GET ?medicineId=
st, d = call(f'/api/questions?medicineId={MID}', token=ctok)
assert st == 200
rows = d['questions']
assert all('helpfulCount' in q and 'hasVoted' in q for q in rows), 'missing vote fields'
pend_rows = [q for q in rows if q['status'] == 'PENDING']
assert any(q['id'] == PENDID for q in pend_rows), 'own PENDING not in list'
print('customer listing:', [(q['status'], q['helpfulCount'], q['hasVoted']) for q in rows])

# 7. guest GET
st, d = call(f'/api/questions?medicineId={MID}')
assert st == 200
assert all(q['status'] == 'ANSWERED' for q in d['questions']), 'guest sees non-answered'
assert all(q.get('hasVoted') in (False, None) for q in d['questions'])
print('guest listing:', [(q['status'], q['helpfulCount'], q.get('hasVoted')) for q in d['questions']])

# 8. mine
st, d = call('/api/questions?mine=1', token=ctok)
assert st == 200 and all('helpfulCount' in q and 'hasVoted' in q for q in d['questions'])
print('mine rows:', [(q['status'], q.get('medicineName'), q['helpfulCount'], q['hasVoted']) for q in d['questions']])

print('QA-VERIFY ALL PASS')
