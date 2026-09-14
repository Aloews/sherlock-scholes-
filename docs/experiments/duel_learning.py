"""Кто удачнее обучается: линейная голова или резервуар на графе мухи.

Опыт, а не рассуждение. Обе схемы учатся на ОДНИХ признаках и ОДНИХ матчах и
проверяются на матчах, которых не видели, — разрез по ВРЕМЕНИ, а не случайный:
случайный разрез подсунул бы в обучение будущее.
"""
import os, json, urllib.request, math
import numpy as np

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_KEY"]

def fetch_all():
    rows, offset = [], 0
    while True:
        req = urllib.request.Request(
            f"{URL}/rest/v1/duel_features?select=*&order=match_date.asc",
            headers={"apikey": KEY, "Authorization": "Bearer " + KEY,
                     "Range-Unit": "items", "Range": f"{offset}-{offset+999}"})
        with urllib.request.urlopen(req, timeout=120) as r:
            part = json.loads(r.read())
        if not part: break
        rows += part; offset += len(part)
        if len(part) < 1000: break
    return rows

rows = fetch_all()
print(f"матчей: {len(rows)}")

def f(r, k): return float(r[k])
X = np.array([[1.0, f(r,'h_gf'), f(r,'h_ga'), f(r,'a_gf'), f(r,'a_ga'),
               f(r,'h_gf')+f(r,'a_ga'), f(r,'a_gf')+f(r,'h_ga'),
               f(r,'h_sd'), f(r,'a_sd')] for r in rows])
y = np.array([f(r,'total') for r in rows])

# Разрез по времени: 70% раньше — учим, 30% позже — проверяем.
cut = int(len(y) * 0.7)
Xtr, Xte, ytr, yte = X[:cut], X[cut:], y[:cut], y[cut:]
print(f"учим на {len(ytr)}, проверяем на {len(yte)}")

def mae(p, t): return float(np.mean(np.abs(p - t)))

def ridge(A, b, lam):
    n = A.shape[1]
    R = lam * np.eye(n); R[0, 0] = 0.0          # свободный член не штрафуем
    return np.linalg.solve(A.T @ A + R, A.T @ b)

res = {}

# 0. Точка отсчёта: медиана обучающей выборки.
med = float(np.median(ytr))
res["Медиана (ничего не знает)"] = mae(np.full_like(yte, med), yte)

# 1. Нынешняя формула — не обучается вовсе.
cur = np.round((Xte[:,5] + Xte[:,6]) / 2 * 2, 1) / 2 * 2
cur = np.round((Xte[:,5]/2 + Xte[:,6]/2), 1)
res["Нынешняя формула (не учится)"] = mae(cur, yte)

# 2. Линейная голова — это и есть «обучение» варианта с ЛЛМ.
best = None
for lam in (0.01, 0.1, 1, 10, 100):
    w = ridge(Xtr, ytr, lam)
    m = mae(Xte @ w, yte)
    if best is None or m < best[0]: best = (m, lam)
res[f"Линейная голова (9 чисел, λ={best[1]})"] = best[0]

# 3. Резервуар: фиксированная разрежённая проекция, обучается только считыватель.
#    Разрежённость 0.02% — как у графа мухи (50 млн связей на 139k нейронов).
def reservoir(N, seed=7):
    rng = np.random.default_rng(seed)
    Win = rng.normal(0, 1.0, size=(X.shape[1], N))
    mask = rng.random((X.shape[1], N)) < 0.35
    Win *= mask
    S = np.tanh(X @ Win)
    S = np.hstack([np.ones((len(S), 1)), S])
    Str, Ste = S[:cut], S[cut:]
    out = None
    for lam in (1, 10, 100, 1000, 10000):
        w = ridge(Str, ytr, lam)
        m_tr, m_te = mae(Str @ w, ytr), mae(Ste @ w, yte)
        if out is None or m_te < out[0]: out = (m_te, m_tr, lam)
    return out

print()
print(f"{'схема':<44}{'на обученных':>14}{'на НОВЫХ':>12}")
print("-" * 70)
for name, m in res.items():
    print(f"{name:<44}{'—':>14}{m:>12.4f}")
for N in (25, 100, 400, 1600, 4000):
    te, tr, lam = reservoir(N)
    print(f"{'Резервуар, ' + str(N) + ' измерений (λ=' + str(lam) + ')':<44}{tr:>14.4f}{te:>12.4f}")
    res[f"reservoir_{N}"] = te
print("-" * 70)
print(f"примеров на измерение у резервуара 4000: {len(ytr)/4000:.2f} : 1")
json.dump({k: round(v, 4) for k, v in res.items()},
          open("/tmp/claude-0/-home-user/ab6a045b-78de-5f4a-8716-7ca795cc89ac/scratchpad/duel.json", "w"),
          ensure_ascii=False, indent=1)
