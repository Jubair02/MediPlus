#!/usr/bin/env python3
"""Round 11 verification — CHECK 7 (PO supplier/expectedAt E2E) + CHECK 8 (rows carry fields)."""
import json, urllib.request, urllib.error, datetime

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
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}

def login(email, password):
    _, d = call('POST', '/api/auth', {'action': 'login', 'email': email, 'password': password})
    return d['token']

PH = login('pharmacist@medplus.com', 'Pharma123!')

print('--- CHECK 7a: restock suggestion -> create-po with supplier + expectedAt ---')
_, d = call('GET', '/api/pharmacist?resource=restock-suggestions', None, PH)
sugs = d['suggestions']
assert len(sugs) > 0, 'no restock suggestions available'
med = sugs[0]
print(f"  using suggestion: {med['name']} (stock {med['stock']}, suggestedQty {med['suggestedQty']}, openPoQty {med['openPoQty']})")
today = datetime.date.today()
plus7 = (today + datetime.timedelta(days=7)).isoformat()
code, d = call('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': med['id'], 'qty': 5, 'supplier': 'Acme Corp', 'expectedAt': plus7}, PH)
assert code == 200, (code, d)
po = d['order']
PO_ID = po['id']
assert po['supplier'] == 'Acme Corp', po
assert po['expectedAt'] == f'{plus7}T00:00:00.000Z', po['expectedAt']
assert po['status'] == 'ORDERED' and po['qty'] == 5
print(f'PASS: 200 create-po -> {PO_ID}; supplier={po["supplier"]!r}, expectedAt={po["expectedAt"]} (local midnight of {plus7})')

print('--- CHECK 7b: validation errors ---')
code, d = call('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': med['id'], 'qty': 5, 'expectedAt': '2020-01-01'}, PH)
assert code == 400 and d['error'] == 'Expected date cannot be in the past', (code, d)
print('PASS: past date -> 400 exactly:', d)
code, d = call('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': med['id'], 'qty': 5, 'expectedAt': 'not-a-date'}, PH)
assert code == 400 and d['error'] == 'Invalid expected date', (code, d)
print('PASS: garbage date -> 400 exactly:', d)
code, d = call('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': med['id'], 'qty': 5, 'supplier': 'S' * 121}, PH)
assert code == 400 and d['error'] == 'Supplier must be 120 characters or less', (code, d)
print('PASS: 121-char supplier -> 400 exactly:', d)
code, d = call('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': med['id'], 'qty': 0, 'supplier': 'Acme Corp', 'expectedAt': plus7}, PH)
assert code == 400 and d['error'] == 'Quantity must be between 1 and 10000', (code, d)
print('PASS: qty 0 -> 400 exactly:', d)
# boundary: exactly 120-char supplier accepted (validated on the cancel-test create below)
sup120 = 'S' * 120
code, d = call('PUT', '/api/pharmacist', {'action': 'create-po', 'medicineId': med['id'], 'qty': 1, 'supplier': sup120, 'note': 'boundary probe'}, PH)
assert code == 200 and d['order']['supplier'] == sup120, (code, d)
BOUNDRY_ID = d['order']['id']
print('PASS: 120-char supplier accepted (boundary), expectedAt absent -> null:', d['order']['expectedAt'])

print('--- CHECK 7c: cancel both test POs, final ORDERED count == 3 ---')
code, d = call('PUT', '/api/pharmacist', {'action': 'cancel-po', 'id': PO_ID}, PH)
assert code == 200 and d['order']['status'] == 'CANCELLED', (code, d)
print('PASS: cancel-po test PO -> CANCELLED')
code, d = call('PUT', '/api/pharmacist', {'action': 'cancel-po', 'id': BOUNDRY_ID}, PH)
assert code == 200 and d['order']['status'] == 'CANCELLED', (code, d)
print('PASS: cancel-po boundary PO -> CANCELLED')

print('--- CHECK 8: purchase-orders rows carry supplier/expectedAt ---')
code, d = call('GET', '/api/pharmacist?resource=purchase-orders', None, PH)
rows = d['orders']
assert all('supplier' in r and 'expectedAt' in r for r in rows), 'supplier/expectedAt missing'
assert d['counts'] == {'ORDERED': 3, 'RECEIVED': 2, 'CANCELLED': 5}, d['counts']  # 3 seeded-legacy + 2 new cancelled
with_supplier = [(r['medicine']['name'], r['qty'], r['supplier'], r['expectedAt'], r['status']) for r in rows if r['supplier']]
for w in with_supplier:
    print('  ', w)
print(f'PASS: all {len(rows)} rows carry supplier+expectedAt; counts = {d["counts"]}')
print('ORDERED rows:', [(r['medicine']['name'], r['qty'], r['note']) for r in rows if r['status'] == 'ORDERED'])
print('ALL CHECK 7+8 ASSERTIONS PASSED')
