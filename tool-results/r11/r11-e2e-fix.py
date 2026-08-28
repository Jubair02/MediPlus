#!/usr/bin/env python3
"""Corrected S4 replace-all/dedup segment (extras must be data:/http(s) per frozen contract) + fixed S10 check."""
import json, urllib.request, urllib.error

BASE = 'http://localhost:3000'
T = {}
for line in open('/tmp/r11tokens.env'):
    k, v = line.strip().split('=', 1)
    T[k] = v
results = []
def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None: r.add_header('Content-Type', 'application/json')
    if token: r.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(r) as res: return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}
def check(name, cond, extra=''):
    results.append((bool(cond), name))
    print(('PASS' if cond else 'FAIL') + f' — {name}' + (f' [{extra}]' if extra and not cond else ''))

ph, ad = T['PH'], T['AD']

# create test med with http primary + dup extra → dedup + imageCount semantics
st, r = req('PUT', '/api/pharmacist', {'action': 'create-medicine', 'data': {
    'name': 'R11 Dedup Test Med', 'price': 11, 'stock': 2,
    'image': 'https://example.com/primary.png',
    'extraImages': ['https://example.com/primary.png', 'https://example.com/other.png']}}, token=ph)
check('S4r create 201 (dup of primary as extra accepted, rows persisted)', st == 201, f"{st} {r}")
mid = r['medicine']['id']
check('S4r create response extraImages keeps raw rows (incl dup)', r['medicine']['extraImages'] == ['https://example.com/primary.png', 'https://example.com/other.png'])
st, r = req('GET', f'/api/medicines?id={mid}')
mm = r['medicine']
check('S4r detail images deduped primary-first', mm['images'] == ['https://example.com/primary.png', 'https://example.com/other.png'], str(mm['images']))
check('S4r imageCount counts rows (3) while images deduped (2)', mm['imageCount'] == 3 and len(mm['images']) == 2)

# replace-all via update (both valid http entries)
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {
    'extraImages': ['https://example.com/repl1.png', 'https://example.com/repl2.png']}}, token=ph)
check('S4r replace-all 200', st == 200, f"{st} {r}")
check('S4r replace-all response extras replaced', r['medicine']['extraImages'] == ['https://example.com/repl1.png', 'https://example.com/repl2.png'])
st, r = req('GET', f'/api/medicines?id={mid}')
check('S4r detail reflects replace-all', r['medicine']['images'] == ['https://example.com/primary.png', 'https://example.com/repl1.png', 'https://example.com/repl2.png'])
# replace-all with dup again → dedup
st, r = req('PUT', '/api/pharmacist', {'action': 'update-medicine', 'id': mid, 'data': {'extraImages': ['https://example.com/primary.png', 'https://example.com/x.png']}}, token=ph)
st, r = req('GET', f'/api/medicines?id={mid}')
check('S4r replace-all with primary-dup dedups images', r['medicine']['images'] == ['https://example.com/primary.png', 'https://example.com/x.png'] and r['medicine']['imageCount'] == 3)

# cleanup
st, r = req('PUT', '/api/admin', {'action': 'delete-medicine', 'id': mid}, token=ad)
check('S4r cleanup delete dedup test med', st == 200)

# fixed S10 check: legacy SEEDED POs keep supplier null (exclude the 3 cancelled E2E test POs + demo supplier PO)
st, r = req('GET', '/api/pharmacist?resource=purchase-orders', token=ph)
rows = r['orders']
test_suppliers = {'Acme Corp', 'Trimmed Supplier'}
legacy = [x for x in rows if x['supplier'] not in test_suppliers and x['id'] != 'cmtc8go420007p6879nvsz9b1']
check('S10r legacy/blank POs have supplier null', all(x['supplier'] is None for x in legacy), str([(x['id'], x['supplier'], x['status']) for x in legacy if x['supplier'] is not None]))
demo_po = next(x for x in rows if x['id'] == 'cmtc8go420007p6879nvsz9b1')
check('S10r demo supplier PO intact', demo_po['supplier'] == 'Square Pharmaceuticals Ltd.' and demo_po['status'] == 'ORDERED')

passed = sum(1 for ok, _ in results if ok)
failed = [n for ok, n in results if not ok]
print(f"\n===== {passed}/{len(results)} assertions passed =====")
if failed: print('FAILED:', failed); raise SystemExit(1)
