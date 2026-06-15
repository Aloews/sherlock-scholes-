"""Tag dry-run counts + sitelinks fetch + "star" redefinition (DO/POSLE).

- Tag counts (free, from cache): goalkeeper, ballon_dor, giant(>=190), dwarf(<=170),
  world_cup (WC or Euro), and WC-only.
- Sitelinks: wbgetentities props=sitelinks per QID -> count of language Wikipedias
  (global-fame proxy). Cached per QID (wikidata_sitelink_count), budget-guarded,
  processed in pageviews-DESC order so the budget covers star-relevant players
  first. Resumable (finish tomorrow).
- Star redefinition: old = pageviews>=19000. Composite candidates shown; reports
  added/removed with examples. No writes.

Run from football_scraper/:  python ../docs/cards_star_redef.py
"""
import os, sys, re, json
import requests
from dotenv import load_dotenv
HERE=os.path.dirname(__file__); SCRAPER=os.path.join(HERE,"..","football_scraper")
sys.path.insert(0,SCRAPER)
import importlib.util
spec=importlib.util.spec_from_file_location("run",os.path.join(SCRAPER,"run.py"))
run=importlib.util.module_from_spec(spec); sys.modules["run"]=run; spec.loader.exec_module(run)
from scraper.cache import FileCache
from scraper.wikidata import WikidataEnricher
ck=run.canonical_key
STAR_OLD=19000
GK="Q172964"
WC_RE=re.compile(r"FIFA World Cup|чемпионат мира по футболу",re.I)
EURO_RE=re.compile(r"UEFA Euro|European Football Championship|European Championship|чемпионат Европы по футболу",re.I)
NOT_SENIOR_RE=re.compile(r"club|клубн|women|женск|under|U-?\d|юнош|молод|олимп|olympic|beach|futsal|qualif|отбор",re.I)
SISTER={"commonswiki","specieswiki","metawiki","mediawikiwiki","wikidatawiki","sourceswiki","foundationwiki","incubatorwiki","outreachwiki"}
def is_langwiki(k): return k.endswith("wiki") and k not in SISTER

def fetch_all(url,key,table,sel,extra=None):
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
    cfg=json.load(open(os.path.join(SCRAPER,"config.json"),encoding="utf-8"))
    cache=FileCache(os.path.join(SCRAPER,"cache"),True)
    budget=run.WikimediaBudget(cfg.get("photos",{}).get("daily_request_budget",5000),os.path.join(SCRAPER,"cache","photos_budget.json"))
    wd=WikidataEnricher(cfg["wikidata"],cache)
    meta=fetch_all(url,key,"players_meta","name_ru,name_en,wikidata_qid")
    qmap={}
    for m in meta:
        q=(m.get("wikidata_qid") or "").strip()
        if not q: continue
        for k in (ck(m.get("name_ru")),ck(m.get("name_en"))):
            if k: qmap.setdefault(k,q)
    cards=fetch_all(url,key,"cards","id,name,name_en,position_ru,pageviews",{"category":"eq.player"})
    def rq(c):
        q=qmap.get(ck(c.get("name"))) or qmap.get(ck(c.get("name_en")))
        if q: return q
        for t in (c.get("name"),f"{c.get('name')} (футболист)"):
            i=cache.get("ruwiki_pageprops",t) if t else None
            if i and i.get("qid") and not i.get("disambig"): return i["qid"]
        return None
    def lab(qid):
        r=cache.get("wikidata_labels",qid) or {}; return r.get("ru") or r.get("en") or ""
    recs=[]
    for c in cards:
        q=rq(c); ent=cache.get("wikidata_entity","ru,en|"+q) if q else None
        cl=(ent or {}).get("claims",{}) if ent else {}
        # tournaments
        wc=euro=False
        for st in cl.get("P1344",[]):
            try: nm=lab(st["mainsnak"]["datavalue"]["value"]["id"])
            except: continue
            if not nm or NOT_SENIOR_RE.search(nm): continue
            if WC_RE.search(nm): wc=True
            elif EURO_RE.search(nm): euro=True
        title=bool(run.legend_titles_from_claims(cl))
        ballon=any("Золотой мяч" in t for t in run.legend_titles_from_claims(cl))
        gk=(c.get("position_ru")=="Вратарь") or (GK in [ (s.get("mainsnak",{}).get("datavalue",{}) or {}).get("value",{}).get("id") for s in cl.get("P413",[])])
        h=None
        for st in cl.get("P2048",[]):
            try: a=float(st["mainsnak"]["datavalue"]["value"]["amount"]); h=int(a*100 if a<3 else a); break
            except: pass
        recs.append({"name":c["name"],"pv":c.get("pageviews") or 0,"qid":q,"ent":bool(ent),
                     "wc":wc,"euro":euro,"title":title,"ballon":ballon,"gk":gk,"h":h})
    # ---- tag dry-run counts ----
    n_gk=sum(1 for r in recs if r["gk"])
    n_ballon=sum(1 for r in recs if r["ballon"])
    n_giant=sum(1 for r in recs if r["h"] and r["h"]>=190)
    n_dwarf=sum(1 for r in recs if r["h"] and 0<r["h"]<=170)
    n_wc=sum(1 for r in recs if r["wc"])
    n_wceuro=sum(1 for r in recs if r["wc"] or r["euro"])
    print("=== TAG DRY-RUN COUNTS ===")
    print(f"  вратари (goalkeeper)        : {n_gk}")
    print(f"  Золотой мяч (ballon_dor)    : {n_ballon}")
    print(f"  великаны >=190 (giant)      : {n_giant}")
    print(f"  малыши <=170 (dwarf)        : {n_dwarf}")
    print(f"  играли на ЧМ (world_cup)    : {n_wc}")
    print(f"  ЧМ ИЛИ Евро                 : {n_wceuro}")
    # ---- sitelinks fetch (pageviews desc) ----
    order=sorted(recs,key=lambda r:r["pv"],reverse=True)
    fetched=cached=0
    for r in order:
        if not r["qid"]: continue
        c=cache.get("wikidata_sitelink_count",r["qid"])
        if c is not None: r["sl"]=c.get("n"); cached+=1; continue
        try: budget.consume()
        except RuntimeError:
            print(f"\n[budget cap reached during sitelinks — {fetched} fetched, rest tomorrow]"); break
        try:
            ents=wd._api({"action":"wbgetentities","ids":r["qid"],"props":"sitelinks"}).get("entities",{})
            sl=(ents.get(r["qid"],{}) or {}).get("sitelinks",{}) or {}
            n=sum(1 for k in sl if is_langwiki(k))
        except Exception: n=None
        cache.set("wikidata_sitelink_count",r["qid"],{"n":n})
        r["sl"]=n; fetched+=1
    for r in recs:
        if "sl" not in r:
            c=cache.get("wikidata_sitelink_count",r["qid"]) if r["qid"] else None
            r["sl"]=(c or {}).get("n") if c else None
    have_sl=[r for r in recs if r.get("sl") is not None]
    print(f"\n=== SITELINKS ===  fetched {fetched}, cached {cached}, coverage {len(have_sl)}/{len(recs)}  budget {budget.used}/{budget.limit}")
    if have_sl:
        sls=sorted((r["sl"] for r in have_sl),reverse=True)
        import statistics
        print(f"  sitelinks distribution: max {sls[0]}, p90 {sls[len(sls)//10]}, median {statistics.median(sls):.0f}")
        # sitelinks among current stars vs non-stars
        cur_star_sl=[r["sl"] for r in have_sl if r["pv"]>=STAR_OLD]
        if cur_star_sl: print(f"  among current stars (pv>=19k): median sitelinks {statistics.median(cur_star_sl):.0f}")
    # ---- star DO/POSLE ----
    star_old=set(r["name"] for r in recs if r["pv"]>=STAR_OLD)
    print(f"\n=== STAR REDEFINITION (DO = pv>=19000: {len(star_old)}) ===")
    for PV_HIGH,N in [(40000,40),(40000,50),(50000,50),(50000,75)]:
        new=set(r["name"] for r in recs if r["pv"]>=PV_HIGH or r["wc"] or r["euro"] or r["title"] or (r.get("sl") or 0)>=N)
        added=new-star_old; removed=star_old-new
        print(f"  PV_HIGH={PV_HIGH}, sitelinks N>={N}: ПОСЛЕ={len(new)}  (+{len(added)} / -{len(removed)})")
    # detailed for recommended
    PV_HIGH,N=50000,50
    new=set(r["name"] for r in recs if r["pv"]>=PV_HIGH or r["wc"] or r["euro"] or r["title"] or (r.get("sl") or 0)>=N)
    added=sorted(new-star_old,key=lambda nm:-next(x["pv"] for x in recs if x["name"]==nm))
    removed=sorted(star_old-new,key=lambda nm:-next(x["pv"] for x in recs if x["name"]==nm))
    print(f"\n  RECOMMENDED PV_HIGH={PV_HIGH}, N>={N}: ПОСЛЕ={len(new)}")
    rb={x["name"]:x for x in recs}
    print("  ADDED (famous, were below 19k) examples:")
    for nm in added[:12]:
        x=rb[nm]; why=[s for s,b in [("ЧМ",x["wc"]),("Евро",x["euro"]),("титул",x["title"]),(f"sl{x.get('sl')}",(x.get('sl') or 0)>=N)] if b]
        print(f"    {nm} (pv {x['pv']}, {','.join(why)})")
    print("  REMOVED (high pv, not corroborated) examples:")
    for nm in removed[:12]:
        x=rb[nm]; print(f"    {nm} (pv {x['pv']}, sl {x.get('sl')})")

if __name__=="__main__": main()
