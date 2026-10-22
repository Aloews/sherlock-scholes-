#!/usr/bin/env python3
"""Вырезать грибовидное тело из коннектома hemibrain v1.2.

⚠️ ЭТОТ ФАЙЛ — ПРОИСХОЖДЕНИЕ ДАННЫХ, А НЕ УДОБСТВО. Рядом лежат
`mb_connectome.npz` и `mb_meta.json`; без этого скрипта они были бы числами
неизвестно откуда, и проверить их было бы нечем.

ИСТОЧНИК. Экспорт связей всех прослеженных нейронов hemibrain v1.2 (Janelia,
neuprint), 45.8 МБ:

    https://storage.googleapis.com/hemibrain/v1.2/exported-traced-adjacencies-v1.2.tar.gz

Внутри: 21 739 нейронов с типами и 3 550 403 пары «нейрон → нейрон» с ЧИСЛОМ
СИНАПСОВ. Это настоящие связи настоящего мозга, а не случайная матрица.

ЧТО ВЫРЕЗАЕТСЯ И ПОЧЕМУ ИМЕННО ЭТО. Грибовидное тело — то место, где муха
учится на подкреплении, и оно целиком лежит в этом наборе:

    PN    132  проекционные нейроны обоняния — вход
    KC   1927  клетки Кеньона — разрежённое расширение
    MBON   68  выходные нейроны — решение
    PAM   301  дофаминовые нейроны НАГРАДЫ
    PPL1   16  дофаминовые нейроны НАКАЗАНИЯ
    APL     1  единственный тормозный нейрон, держащий разрежённость

⚠️ ПРОВЕРКА, ЧТО ВЫРЕЗАНО ПРАВИЛЬНО, ЕСТЬ, И ОНА НЕ ПРО КОД. У клетки Кеньона
в среднем 6–7 входов от PN («когти») — это измеренная биология, опубликованная
независимо от нас. Медиана по выгрузке: 6. Ошибись отбор типов — число уехало
бы сразу.

Компартмент (γ1pedc, β'2a, α3 …) берётся из имени экземпляра: `MBON01(y1pedc)_R`.
Он и есть адрес, по которому дофамин достаёт синапс: DAN компартмента меняет
именно те KC→MBON связи, что лежат в нём.

    python3 extract_mushroom_body.py <папка-с-выгрузкой> [<куда-класть>]
"""
from __future__ import annotations

import collections
import csv
import json
import os
import re
import sys

import numpy as np

# Унигломерулярный проекционный нейрон: DA1_lPN, DM6_adPN, VL2p_adPN…
PN_RE = re.compile(r"[A-Z0-9]+[a-z]?_(ad|l|v|il|vl|lv|m)?PN")
COMP_RE = re.compile(r"\(([^)]+)\)")

# Ожидания, проверяемые на выгрузке. Числа — из опубликованной анатомии
# hemibrain; расходятся — значит отбор типов сломан, и молчать об этом нельзя.
EXPECT = {"PN": (120, 150), "KC": (1800, 2000), "MBON": (60, 80),
          "PAM": (280, 320), "PPL1": (10, 25), "APL": (1, 2)}
CLAWS_RANGE = (5, 8)  # медиана входов PN на одну клетку Кеньона


def load_neurons(d: str) -> dict[int, tuple[str, str]]:
    out: dict[int, tuple[str, str]] = {}
    with open(os.path.join(d, "traced-neurons.csv")) as f:
        for r in csv.DictReader(f):
            out[int(r["bodyId"])] = (r["type"] or "", r["instance"] or "")
    return out


def compartment(instance: str) -> str | None:
    m = COMP_RE.search(instance)
    return m.group(1) if m else None


def pick(neurons: dict[int, tuple[str, str]]) -> dict[str, list[int]]:
    def by(pred) -> list[int]:
        return sorted(b for b, (t, _) in neurons.items() if pred(t))

    return {
        "PN": by(lambda t: bool(PN_RE.fullmatch(t or ""))),
        "KC": by(lambda t: t.startswith("KC")),
        "MBON": by(lambda t: t.startswith("MBON")),
        "PAM": by(lambda t: t.startswith("PAM")),
        "PPL1": by(lambda t: t.startswith("PPL1")),
        "APL": by(lambda t: t.startswith("APL")),
    }


def extract(src: str, dst: str) -> dict:
    neurons = load_neurons(src)
    groups = pick(neurons)
    for name, (lo, hi) in EXPECT.items():
        n = len(groups[name])
        if not lo <= n <= hi:
            raise SystemExit(f"{name}: найдено {n}, ждали {lo}..{hi} — отбор типов сломан")

    ix = {k: {b: i for i, b in enumerate(v)} for k, v in groups.items()}
    apl = set(groups["APL"])
    pn_kc: collections.Counter = collections.Counter()
    kc_mbon: collections.Counter = collections.Counter()
    kc_apl = np.zeros(len(groups["KC"]), dtype=np.float32)
    apl_kc = np.zeros(len(groups["KC"]), dtype=np.float32)

    with open(os.path.join(src, "traced-total-connections.csv")) as f:
        for row in csv.reader(f):
            if row[0] == "bodyId_pre":
                continue
            a, b, w = int(row[0]), int(row[1]), int(row[2])
            if a in ix["PN"] and b in ix["KC"]:
                pn_kc[(ix["PN"][a], ix["KC"][b])] += w
            elif a in ix["KC"] and b in ix["MBON"]:
                kc_mbon[(ix["KC"][a], ix["MBON"][b])] += w
            elif a in ix["KC"] and b in apl:
                kc_apl[ix["KC"][a]] += w
            elif a in apl and b in ix["KC"]:
                apl_kc[ix["KC"][b]] += w

    def sparse(cnt):
        keys = np.array(list(cnt.keys()), dtype=np.int32)
        return keys[:, 0], keys[:, 1], np.array(list(cnt.values()), dtype=np.float32)

    p_r, p_c, p_v = sparse(pn_kc)
    m_r, m_c, m_v = sparse(kc_mbon)

    claws = int(np.median(np.bincount(p_c, minlength=len(groups["KC"]))))
    if not CLAWS_RANGE[0] <= claws <= CLAWS_RANGE[1]:
        raise SystemExit(
            f"медиана входов PN на KC = {claws}, у мухи 5..8 — выгрузка не та"
        )

    os.makedirs(dst, exist_ok=True)
    np.savez_compressed(
        os.path.join(dst, "mb_connectome.npz"),
        pn_kc_row=p_r, pn_kc_col=p_c, pn_kc_w=p_v,
        kc_mbon_row=m_r, kc_mbon_col=m_c, kc_mbon_w=m_v,
        kc_apl=kc_apl, apl_kc=apl_kc,
    )
    meta = {
        "source": "hemibrain v1.2 exported-traced-adjacencies (neuprint, Janelia)",
        "claws_median": claws,
        "pn": [{"id": b, "type": neurons[b][0]} for b in groups["PN"]],
        "kc": [{"id": b, "type": neurons[b][0]} for b in groups["KC"]],
        "mbon": [
            {"id": b, "type": neurons[b][0], "comp": compartment(neurons[b][1])}
            for b in groups["MBON"]
        ],
        "dan": [
            {"id": b, "type": neurons[b][0], "comp": compartment(neurons[b][1]),
             "valence": "reward" if neurons[b][0].startswith("PAM") else "punish"}
            for b in groups["PAM"] + groups["PPL1"]
        ],
    }
    with open(os.path.join(dst, "mb_meta.json"), "w") as f:
        json.dump(meta, f, ensure_ascii=False)
    return {k: len(v) for k, v in groups.items()} | {
        "PN->KC": len(pn_kc), "KC->MBON": len(kc_mbon), "claws": claws,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    print(extract(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "."))
