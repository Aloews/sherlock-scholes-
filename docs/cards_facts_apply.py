"""Apply cards.facts (JSONB) + cards.tags (TEXT[]) — CACHE-ONLY, 0 budget.

Reads only the on-disk caches (wikidata_entity, wikidata_labels, ruwiki_pageprops)
populated by earlier passes, so it makes NO Wikidata calls and never touches
photos_budget.json — safe to run alongside the sitelinks fetch. PATCHes facts +
the five chosen tags (goalkeeper, ballon_dor, giant>=190, dwarf<=170,
world_cup=WC|Euro). The 'star' tag is added later once sitelinks are complete.
Idempotent (PATCH only when changed).

Run from football_scraper/:  python ../docs/cards_facts_apply.py
"""
import os, sys, re, json, datetime
import requests
from dotenv import load_dotenv
HERE=os.path.dirname(__file__); SCRAPER=os.path.join(HERE,"..","football_scraper")
sys.path.insert(0,SCRAPER)
import importlib.util
spec=importlib.util.spec_from_file_location("run",os.path.join(SCRAPER,"run.py"))
run=importlib.util.module_from_spec(spec); sys.modules["run"]=run; spec.loader.exec_module(run)
from scraper.cache import FileCache
ck=run.canonical_key
THIS_YEAR=datetime.date.today().year
GK="Q172964"
WC_RE=re.compile(r"FIFA World Cup|чемпионат мира по футболу",re.I)
EURO_RE=re.compile(r"UEFA Euro|European Football Championship|European Championship|чемпионат Европы по футболу",re.I)
NOT_SENIOR_RE=re.compile(r"club|клубн|women|женск|under|U-?\d|юнош|молод|олимп|olympic|beach|futsal|qualif|отбор",re.I)
NAT_RE=re.compile(r"national.*team|сборн",re.I)
YOUTH_RE=re.compile(r"under|U-?\d|олимп|olympic|молод|youth|B national|women|женск",re.I)
YEAR_RE=re.compile(r"(\d{4})")

def fa(url,key,table,sel,extra=None):
    out,off=[],0
    while True:
        p={"select":sel,"limit":1000,"offset":off}; p.update(extra or {})
        r=requests.get(url.rstrip("/")+f"/rest/v1/{table}",headers={"apikey":key,"Authorization":"Bearer "+key},params=p,timeout=30)
        r.raise_for_status(); b=r.json(); out+=b
        if len(b)<1000: break
        off+=1000
    return out

def main():
    load_dotenv(os.path.join(SCRAPER,".env"))
    url,key=os.environ["SUPABASE_URL"],os.environ["SUPABASE_KEY"]
    PATCH={"apikey":key,"Authorization":"Bearer "+key,"Content-Type":"application/json","Prefer":"return=minimal"}
    cache=FileCache(os.path.join(SCRAPER,"cache"),True)
    meta=fa(url,key,"players_meta","name_ru,name_en,wikidata_qid")
    qmap={}
    for m in meta:
        q=(m.get("wikidata_qid") or "").strip()
        if not q: continue
        for k in (ck(m.get("name_ru")),ck(m.get("name_en"))):
            if k: qmap.setdefault(k,q)
    cards=fa(url,key,"cards","id,name,name_en,position_ru,facts,tags",{"category":"eq.player"})
    def rq(c):
        q=qmap.get(ck(c.get("name"))) or qmap.get(ck(c.get("name_en")))
        if q: return q
        for t in (c.get("name"),f"{c.get('name')} (футболист)"):
            i=cache.get("ruwiki_pageprops",t) if t else None
            if i and i.get("qid") and not i.get("disambig"): return i["qid"]
        return None
    def lab(qid):
        r=cache.get("wikidata_labels",qid) or {}; return r.get("ru") or r.get("en") or ""
    def iq(cl,prop):
        o=[]
        for st in (cl or {}).get(prop,[]):
            try: o.append((st["mainsnak"]["datavalue"]["value"]["id"],st.get("qualifiers",{}) or {}))
            except: pass
        return o
    def qty(q,prop):
        try: return int(float(q[prop][0]["datavalue"]["value"]["amount"]))
        except: return None
    def short_nat(nm):
        nm=re.sub(r'^[Сс]борная\s+','',nm); nm=re.sub(r'\s+по футболу$','',nm)
        nm=re.sub(r'\s*national football team$','',nm,flags=re.I); return nm.strip()
    tagc={k:0 for k in ("goalkeeper","ballon_dor","giant","dwarf","world_cup")}
    patched=0; with_facts=0
    for c in cards:
        q=rq(c); ent=cache.get("wikidata_entity","ru,en|"+q) if q else None
        if not ent: continue
        cl=ent.get("claims",{}) or {}
        f={}
        if c.get("position_ru"): f["position"]=c["position_ru"]
        for st in cl.get("P2048",[]):
            try: a=float(st["mainsnak"]["datavalue"]["value"]["amount"]); f["height_cm"]=int(a*100 if a<3 else a); break
            except: pass
        for st in cl.get("P569",[]):
            try: f["birth_year"]=int(st["mainsnak"]["datavalue"]["value"]["time"][1:5]); break
            except: pass
        club_spans=[]; nat={}
        for qid,ql in iq(cl,"P54"):
            nm=lab(qid); s,e=run._wd_year(ql,"P580"),run._wd_year(ql,"P582")
            if nm and NAT_RE.search(nm):
                if YOUTH_RE.search(nm): continue
                caps=qty(ql,"P1350") or 0; nat[nm]=max(nat.get(nm,0),caps)
            else:
                club_spans.append((int(s) if s else None,int(e) if e else None))
        cc=len(set(qid for qid,_ in iq(cl,"P54") if not (lab(qid) and NAT_RE.search(lab(qid)))))
        if cc: f["clubs_count"]=cc
        starts=[s for s,e in club_spans if s]; ends=[e for s,e in club_spans if e]
        span=0
        if starts:
            lo=min(starts); hi=max(ends) if ends else THIS_YEAR; span=hi-lo
            f["years_active"]=f"{lo}–{hi}" if ends else f"{lo}–"
        if nat:
            team=max(nat,key=lambda k:nat[k]); f["national_team"]=short_nat(team)
            if nat[team]: f["national_caps"]=nat[team]
        tours=[]
        for qid,_ in iq(cl,"P1344"):
            nm=lab(qid)
            if not nm or NOT_SENIOR_RE.search(nm): continue
            mt=YEAR_RE.search(nm); y=mt.group(1) if mt else None
            if WC_RE.search(nm): tours.append(f"ЧМ-{y}" if y else "ЧМ")
            elif EURO_RE.search(nm): tours.append(f"Евро-{y}" if y else "Евро")
        tours=sorted(set(tours))
        if tours: f["tournaments"]=tours
        titles=run.legend_titles_from_claims(cl)
        if titles: f["titles"]=titles
        # tags (the 5 chosen)
        tags=[]
        if c.get("position_ru")=="Вратарь" or GK in [qid for qid,_ in iq(cl,"P413")]: tags.append("goalkeeper")
        if any("Золотой мяч" in t for t in titles): tags.append("ballon_dor")
        if f.get("height_cm") and f["height_cm"]>=190: tags.append("giant")
        if f.get("height_cm") and 0<f["height_cm"]<=170: tags.append("dwarf")
        if tours: tags.append("world_cup")
        for t in tags: tagc[t]+=1
        if f: with_facts+=1
        body={}
        if f!=(c.get("facts") or {}): body["facts"]=f
        if sorted(tags)!=sorted(c.get("tags") or []): body["tags"]=tags
        if body:
            requests.patch(url.rstrip("/")+"/rest/v1/cards",headers=PATCH,params={"id":"eq."+str(c["id"])},json=body,timeout=30).raise_for_status()
            patched+=1
    print(f"PATCHed {patched} cards | facts set on {with_facts}")
    print("tag counts:")
    names={"goalkeeper":"вратари","ballon_dor":"Золотой мяч","giant":"великаны>=190","dwarf":"малыши<=170","world_cup":"играли на ЧМ/Евро"}
    for k in tagc: print(f"  {names[k]:22}: {tagc[k]}")

if __name__=="__main__": main()
