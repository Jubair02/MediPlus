#!/usr/bin/env python3
"""Round 11 backend E2E verification (task 11-a) — all 11 suites vs live dev server."""
import json, time, urllib.request, urllib.error

BASE = 'http://localhost:3000'
T = {}
for line in open('/tmp/r11tokens.env'):
    k, v = line.strip().split('=', 1)
    T[k] = v

results = []

def req(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if body is not None: r.add_header('Content-Type', 'application/json')
    if token: r.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(r) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}

def check(name, cond, extra=''):
    results.append((bool(cond), name))
    print(('PASS' if cond else 'FAIL') + f' — {name}' + (f' [{extra}]' if extra and not cond else ''))

# ---------- tokens ----------
ph, ad, cu, nu = T['PH'], T['AD'], T['CU'], T['NU']

# ---------- Suite 1: detail gallery on Napa Extra ----------
st, r = req('GET', '/api/medicines?limit=50')
napa = next(m for m in r['medicines'] if m['name'] == 'Napa Extra 500mg+65mg')
st, r = req('GET', f"/api/medicines?id={napa['id']}")
m = r['medicine']
check('S1 detail 200', st == 200)
check('S1 images>=3', isinstance(m.get('images'), list) and len(m['images']) >= 3, str(m.get('images')))
check('S1 primary first', m.get('images', [None])[0] == '/images/med-napa.png')
check('S1 imageCount == 1+extras', m.get('imageCount') == 1 + len(m.get('extraImages', [])), f"imageCount={m.get('imageCount')} extras={m.get('extraImages')}")
check('S1 extraImages sorted/urls', m.get('extraImages') == ['/images/med-vitaminc.png', '/images/med-zinconia.png'], str(m.get('extraImages')))

# ---------- Suite 2: public list lean rows ----------
st, r = req('GET', '/api/medicines?limit=12')
rows = r['medicines']
check('S2 list 200 rows=12', st == 200 and len(rows) == 12)
check('S2 every row has imageCount int', all(isinstance(x.get('imageCount'), int) for x in rows))
check('S2 no images array on list rows', all('images' not in x for x in rows))
check('S2 no extraImages on list rows', all('extraImages' not in x for x in rows))
napa_row = next(x for x in rows if x['id'] == napa['id'])
check('S2 napa list imageCount==3', napa_row['imageCount'] == 3, str(napa_row['imageCount']))
plain = next(x for x in rows if x['id'] != napa['id'])
st2, r2 = req('GET', f"/api/medicines?id={plain['id']}")
check('S2 single-image med imageCount==1', plain['imageCount'] == 1 and r2['medicine']['imageCount'] == 1)
# recommended endpoint also list-shaped
st, r = req('GET', '/api/medicines?recommended=true&limit=4', token=cu)
check('S2 recommended rows have imageCount, no images[]', st == 200 and all('imageCount' in x and 'images' not in x for x in r['medicines']))

# ---------- Suite 3: pharmacist medicines rows ----------
st, r = req('GET', '/api/pharmacist?resource=medicines', token=ph)
pm = {x['name']: x for x in r['medicines']}
check('S3 pharmacist medicines 200', st == 200)
check('S3 rows carry extraImages[]', isinstance(pm['Napa Extra 500mg+65mg']['extraImages'], list) and len(pm['Napa Extra 500mg+65mg']['extraImages']) == 2)
check('S3 rows carry imageCount', all(isinstance(x.get('imageCount'), int) for x in r['medicines']))
check('S3 amoxin extraImages==[cef3]', pm['Amoxin 500mg']['extraImages'] == ['/images/med-cef3.png'])

st, r = req('GET', '/api/admin?resource=medicines', token=ad)
am = {x['name']: x for x in r['medicines']}
check('S3b admin medicines rows carry extraImages+imageCount', am['Napa Extra 500mg+65mg']['extraImages'] == ['/images/med-vitaminc.png', '/images/med-zinconia.png'] and am['Napa Extra 500mg+65mg']['imageCount'] == 3)

# ---------- Suite 4: create/update-medicine with extraImages (pharmacist) ----------
data_url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
st, r = req('PUT', '/api/pharmacist', {'action': 'create-medicine', 'data': {
    'name': 'R11 Gallery Test Med', 'price': 42, 'stock': 7, 'image': '/images/med-ace.png',
    'extraImages': [data_url]}}, token=ph)
check('S4 create 201', st == 201, str(r))
tm = r.get('medicine', {})
check('S4 create response carries extraImages persisted', tm.get('extraImages') == [data_url], str(tm.get('extraImages')))
check('S4 create response imageCount==2', tm.get('imageCount') == 2)
mid = tm['id']
st, r = req('GET', f'/api/medicines?id={mid}')
check('S4 detail reflects created extras', st == 200 and r['medicine']['images'] == ['/images/med-ace.png', data_url] and r['medicine']['imageCount'] == 2)

# replace-all with [primary-url dup + other] → dedup in images, imageCount counts both
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {
    'extraImages': ['/images/med-ace.png', '/images/med-bandage.png']}}, token=ph)
check('S4 replace-all 200', st == 200)
st, r = req('GET', f'/api/medicines?id={mid}')
mm = r['medicine']
check('S4 dedup: images primary-first no repeats', mm['images'] == ['/images/med-ace.png', '/images/med-bandage.png'], str(mm['images']))
check('S4 imageCount counts rows (3) while images deduped (2)', mm['imageCount'] == 3 and len(mm['images']) == 2)

# clear with []
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {'extraImages': []}}, token=ph)
st, r = req('GET', f'/api/medicines?id={mid}')
check('S4 empty array clears all', r['medicine'].get('extraImages') == [] and r['medicine']['imageCount'] == 1 and r['medicine']['images'] == ['/images/med-ace.png'])

# key absent = untouched
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {'extraImages': [data_url]}}, token=ph)
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {'price': 45}}, token=ph)
check('S4 key absent leaves extras untouched', r['medicine']['extraImages'] == [data_url] and r['medicine']['price'] == 45)

# 6 entries → 400
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {
    'extraImages': [data_url, 'https://x/1.png', 'https://x/2.png', 'https://x/3.png', 'https://x/4.png', 'https://x/5.png']}}, token=ph)
check('S4 6 entries → 400 At most 5 extra images are allowed', st == 400 and r.get('error') == 'At most 5 extra images are allowed', f"{st} {r}")

# non-image string → 400
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {'extraImages': ['not-an-image']}}, token=ph)
check('S4 non-image → 400 Invalid image at position 1', st == 400 and r.get('error') == 'Invalid image at position 1', f"{st} {r}")
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {'extraImages': [data_url, 'ftp://bad']}}, token=ph)
check('S4 bad prefix at pos 2 → Invalid image at position 2', st == 400 and r.get('error') == 'Invalid image at position 2')
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {'extraImages': 'nope'}}, token=ph)
check('S4 non-array → 400 Images must be an array', st == 400 and r.get('error') == 'Images must be an array')

# admin route parity: update via admin
st, r = req('PUT', '/api/admin', {'action': 'update-medicine', 'id': mid, 'data': {'extraImages': ['https://example.com/a.png']}}, token=ad)
check('S4b admin update-medicine accepts extraImages', st == 200 and r['medicine']['extraImages'] == ['https://example.com/a.png'], f"{st} {r}")
st, r = req('PUT', '/api/admin', {'action': 'create-medicine', 'data': {'name': 'R11 Admin Gallery Test', 'price': 9, 'stock': 1, 'extraImages': ['data:image/gif;base64,AAAA']}}, token=ad)
check('S4b admin create-medicine 201 with extras', st == 201 and r['medicine']['extraImages'] == ['data:image/gif;base64,AAAA'])
admin_med_id = r.get('medicine', {}).get('id')

# cleanup both test medicines via admin delete-medicine
st, r = req('PUT', '/api/admin', {'action': 'delete-medicine', 'id': mid}, token=ad)
check('S4 cleanup delete test med (pharmacist)', st == 200)
st, r = req('PUT', '/api/admin', {'action': 'delete-medicine', 'id': admin_med_id}, token=ad)
check('S4b cleanup delete admin test med', st == 200)
st, r = req('GET', f'/api/medicines?id={mid}')
check('S4 cleaned-up med detail → 404', st == 404)

# ---------- Suite 6: POST question + canEdit visibility ----------
st, r = req('POST', '/api/questions', {'medicineId': plain['id'], 'question': 'R11 canEdit visibility test question'}, token=cu)
check('S6 POST 201', st == 201, f"{st} {r}")
tq_id = r['question']['id']
check('S6 POST row canEdit true', r['question'].get('canEdit') is True)
st, r = req('GET', f'/api/questions?medicineId={plain["id"]}', token=cu)
check('S6 owner GET canEdit true', any(x['id'] == tq_id and x.get('canEdit') is True for x in r['questions']))
st, r = req('GET', f'/api/questions?medicineId={plain["id"]}')
check('S6 guest GET canEdit false on all rows', all(x.get('canEdit') is False for x in r['questions']))
check('S6 no userId leak in public rows', all('userId' not in x for x in r['questions']))
st, r = req('GET', f'/api/questions?medicineId={plain["id"]}', token=nu)
check('S6 other-user GET canEdit false', all(x.get('canEdit') is False for x in r['questions']))
st, r = req('GET', '/api/questions?mine=1', token=cu)
check('S6 mine rows carry canEdit', any(x['id'] == tq_id and x.get('canEdit') is True for x in r['questions']))

# ---------- Suite 7: PUT edit on the seeded demo question ----------
demo_q = 'cmtc8go400005p687k1sggvuc'
st, r = req('GET', '/api/questions?mine=1', token=cu)
demo_before = next(x for x in r['questions'] if x['id'] == demo_q)
orig_text = demo_before['question']
st, r = req('PUT', '/api/questions', {'id': demo_q, 'question': 'Edited text for QA window test'}, token=cu)
check('S7 edit 200', st == 200, f"{st} {r}")
q = r.get('question', {})
check('S7 text changed', q.get('question') == 'Edited text for QA window test')
check('S7 response shape matches GET rows', set(q.keys()) == {'id', 'question', 'answer', 'status', 'createdAt', 'answeredAt', 'askedByName', 'answerByName', 'helpfulCount', 'hasVoted', 'canEdit'}, str(sorted(q.keys())))
check('S7 helpfulCount 0 while pending', q.get('helpfulCount') == 0)
check('S7 canEdit recomputed true', q.get('canEdit') is True)
st, r = req('PUT', '/api/questions', {'id': demo_q, 'question': 'Edited again inside window'}, token=cu)
check('S7 second edit still OK within window', st == 200 and r['question']['question'] == 'Edited again inside window')
st, r = req('PUT', '/api/questions', {'id': demo_q, 'question': 'nusrat trying to edit'}, token=nu)
check('S7 non-owner → 403 You can only edit your own questions', st == 403 and r.get('error') == 'You can only edit your own questions')
st, r = req('PUT', '/api/questions', {'id': demo_q, 'question': 'guest edit attempt'})
check('S7 guest → 401', st == 401)
st, r = req('PUT', '/api/questions', {'id': 'nonexistent-qid', 'question': 'does not matter'}, token=cu)
check('S7 unknown id → 404 Question not found', st == 404 and r.get('error') == 'Question not found')
st, r = req('PUT', '/api/questions', {'id': demo_q, 'question': 'abc'}, token=cu)
check('S7 too-short text → 400 min length', st == 400 and r.get('error') == 'Question must be at least 5 characters')

# ---------- Suite 8: pharmacist edited flag ----------
st, r = req('GET', '/api/pharmacist?resource=questions&status=PENDING', token=ph)
row = next(x for x in r['questions'] if x['id'] == demo_q)
check('S8 pharmacist row edited true', row.get('edited') is True, str(row.get('edited')))
check('S8 no updatedAt leaked in pharmacist rows', all('updatedAt' not in x for x in r['questions']))
check('S8 no userId leak in pharmacist rows', all('userId' not in x for x in r['questions']))
throwaway = next((x for x in r['questions'] if x['id'] == tq_id), None)
check('S8 untouched throwaway row edited false', throwaway is not None and throwaway.get('edited') is False)

# restore demo question text to original (report: restored; edited flag legitimately stays true)
st, r = req('PUT', '/api/questions', {'id': demo_q, 'question': orig_text}, token=cu)
check('S7b restore original demo text', st == 200 and r['question']['question'] == orig_text)

# cleanup throwaway question (owner, still PENDING)
st, r = req('DELETE', f'/api/questions?id={tq_id}', token=cu)
check('S6b cleanup delete throwaway question', st == 200)
st, r = req('GET', '/api/pharmacist?resource=questions&status=PENDING', token=ph)
check('S6b throwaway gone from pharmacist queue', all(x['id'] != tq_id for x in r['questions']))

# ---------- Suite 9: create-po supplier + expectedAt ----------
import datetime
d7 = (datetime.date.today() + datetime.timedelta(days=7)).isoformat()
st, r = req('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': plain['id'], 'qty': 5, 'supplier': 'Acme Corp', 'expectedAt': d7}, token=ph)
check('S9 create-po 200 with supplier+expectedAt', st == 200 and r.get('order', {}).get('supplier') == 'Acme Corp' and r['order'].get('expectedAt', '').startswith(d7), f"{st} {r}")
test_po_id = r.get('order', {}).get('id')
st, r = req('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': plain['id'], 'qty': 5, 'expectedAt': '2020-01-01'}, token=ph)
check('S9 past date → 400 Expected date cannot be in the past', st == 400 and r.get('error') == 'Expected date cannot be in the past')
st, r = req('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': plain['id'], 'qty': 5, 'expectedAt': 'not-a-date'}, token=ph)
check('S9 invalid date → 400 Invalid expected date', st == 400 and r.get('error') == 'Invalid expected date')
st, r = req('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': plain['id'], 'qty': 5, 'supplier': 'S' * 121}, token=ph)
check('S9 supplier 121 chars → 400 Supplier must be 120 characters or less', st == 400 and r.get('error') == 'Supplier must be 120 characters or less')
st, r = req('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': plain['id'], 'qty': 5, 'supplier': '  Trimmed Supplier  ', 'expectedAt': d7 + 'T10:30:00.000Z'}, token=ph)
check('S9 supplier trimmed + ISO expectedAt accepted', st == 200 and r['order']['supplier'] == 'Trimmed Supplier', f"{st} {r}")
iso_po_id = r.get('order', {}).get('id')
st, r = req('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': plain['id'], 'qty': 5, 'supplier': '', 'expectedAt': ''}, token=ph)
check('S9 empty supplier/expectedAt → nulls', st == 200 and r['order']['supplier'] is None and r['order']['expectedAt'] is None)
blank_po_id = r.get('order', {}).get('id')

# cancel all three test POs
for pid in [test_po_id, iso_po_id, blank_po_id]:
    st, r = req('PUT', '/api/pharmacist', {'action': 'cancel-po', 'id': pid}, token=ph)
    check(f'S9 cleanup cancel-po {str(pid)[:8]}', st == 200 and r['order']['status'] == 'CANCELLED')

# ---------- Suite 10: purchase-orders rows carry supplier/expectedAt ----------
st, r = req('GET', '/api/pharmacist?resource=purchase-orders', token=ph)
check('S10 purchase-orders 200', st == 200)
rows = r['orders']
check('S10 all rows carry supplier+expectedAt keys', all('supplier' in x and 'expectedAt' in x for x in rows))
demo_po = next(x for x in rows if x['id'] == 'cmtc8go420007p6879nvsz9b1')
check('S10 seeded supplier PO present', demo_po['supplier'] == 'Square Pharmaceuticals Ltd.' and demo_po['qty'] == 40 and demo_po['status'] == 'ORDERED', str(demo_po)[:200])
check('S10 legacy POs supplier null', all(x['supplier'] is None for x in rows if x['id'] != 'cmtc8go420007p6879nvsz9b1'))

# ---------- Suite 11: guards ----------
st, r = req('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': plain['id'], 'qty': 5})
check('S11 create-po no-token → 401', st == 401)
st, r = req('PUT', '/api/pharmacist', {'action': 'create-medicine', 'data': {'name': 'x', 'price': 1}})
check('S11 create-medicine no-token → 401', st == 401)
st, r = req('PUT', '/api/admin', {'action': 'create-medicine', 'data': {'name': 'x', 'price': 1}})
check('S11 admin create-medicine no-token → 401', st == 401)
st, r = req('PUT', '/api/questions', {'id': 'x', 'question': 'hello'})
check('S11 questions PUT no-token → 401', st == 401)
st, r = req('PUT', '/api/pharmacist', {'action': 'create-medicine', 'data': {'name': 'x', 'price': 1}}, token=cu)
check('S11 customer on pharmacist route → 403', st == 403)
st, r = req('GET', '/api/pharmacist?resource=purchase-orders')
check('S11 purchase-orders no-token → 401', st == 401)

# ---------- summary ----------
passed = sum(1 for ok, _ in results if ok)
failed = [n for ok, n in results if not ok]
print(f"\n===== {passed}/{len(results)} assertions passed =====")
if failed:
    print('FAILED:', failed)
    raise SystemExit(1)
