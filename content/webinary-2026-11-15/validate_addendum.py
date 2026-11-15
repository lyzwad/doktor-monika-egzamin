import json,hashlib,re,sys
from pathlib import Path
p=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parent
f=p/'bank_webinar_addendum.json';b=json.loads(f.read_text());m=json.loads((p/'MANIFEST.json').read_text());q=b['questions']
assert hashlib.sha256(f.read_bytes()).hexdigest()==m['bank_sha256']
assert b['integration_mode']=='append' and m['mode']=='append'
assert 200<=len(q)<=300 and len(q)==b['count']==m['question_count']
assert len({x['id'] for x in q})==len(q)
assert set(m['active_ids'])=={x['id'] for x in q}
for x in q:
 assert x['id'].startswith('WB-') and x['stem_pl'].endswith('[webinar]')
 assert len(x['options'])==4 and {o['id'] for o in x['options']}==set('ABCD')
 assert len({re.sub(r'\s+',' ',o['text_pl']).strip().lower() for o in x['options']})==4
 assert x['correct_option_id'] in 'ABCD' and x['correct_explanation_pl']
 assert x['source_id'] in b['sources'] and all(s in b['sources'] for s in x['source_ids'])
 assert x['evidence_quote'] and x['evidence_unit_ids']
 assert x['clinical_signoff'] is False
print(f'PASS: {len(q)} questions, append mode, unique IDs, structure and SHA. This does not certify medical correctness.')
