# -*- coding: utf-8 -*-
"""Один разговор с Supabase на все сборщики: с повторами и громкими ошибками.

ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ. Ночной обход, шедший час, умер на строчке
`urllib.error.URLError: [SSL: UNEXPECTED_EOF_WHILE_READING]` — соединение
оборвалось на одном вызове, и весь прогон вместе с ним. У каждого сборщика был
свой `sb()`, и ни один не переживал обрыва. Это не правило предметной области,
которое нельзя дублировать, — это транспорт, и копий его быть не должно.

⚠️ ОБРЫВ СВЯЗИ И ОТКАЗ СЕРВЕРА — РАЗНЫЕ СОБЫТИЯ, И ВЕДЁМ СЕБЯ РАЗНО.
Обрыв (SSL, таймаут, сброс) — повторяем: сервер ничего не сказал.
Ответ 4xx/5xx — сервер сказал, и это надо ПЕЧАТАТЬ, а не глотать. Но один
испорченный игрок из девяти тысяч не должен убивать прогон: считаем отказы и
валимся, только когда их становится много, — тогда это уже поломка, а не
кривая строка. Молчаливое проглатывание запрещено: зелёный пустой прогон
хуже красного.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

RETRIES = 4
BACKOFF = 3.0
#: Столько отказов сервера подряд по всему прогону — уже не строка, а поломка.
MAX_HTTP_ERRORS = 20

_http_errors = 0


class SupabaseDown(SystemExit):
    """Сервер отвечает отказом слишком часто — дальше идти бессмысленно."""


def sb(path, method="GET", body=None, params=None, timeout=180):
    """Запрос к PostgREST. Возвращает разобранный JSON или [] на пустом ответе.

    На отказе сервера печатает ТЕЛО ошибки (в нём всегда написано, что не так:
    `permission denied for table`, `date/time field value out of range`) и
    возвращает None — вызывающий решает, считать это потерей или пропуском.
    """
    global _http_errors
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    key = os.environ["SUPABASE_KEY"]
    data = json.dumps(body).encode() if body is not None else None

    for attempt in range(RETRIES):
        req = urllib.request.Request(url, data=data, method=method, headers={
            "apikey": key, "Authorization": "Bearer " + key,
            "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as fh:
                raw = fh.read()
            return json.loads(raw) if raw else []
        except urllib.error.HTTPError as e:
            _http_errors += 1
            print("  ⚠️ %s %s: HTTP %s — %s"
                  % (method, path, e.code, e.read().decode("utf-8", "replace")[:200]),
                  flush=True)
            if _http_errors >= MAX_HTTP_ERRORS:
                raise SupabaseDown(
                    "Отказов сервера подряд: %d — это поломка, а не кривая "
                    "строка. Прогон остановлен." % _http_errors)
            return None
        except Exception as e:                                   # noqa: BLE001
            # Обрыв связи: сервер НИЧЕГО не сказал, повторяем.
            if attempt + 1 == RETRIES:
                print("  ⚠️ %s %s: связь оборвалась %d раза — %s"
                      % (method, path, RETRIES, str(e)[:120]), flush=True)
                return None
            time.sleep(BACKOFF * (attempt + 1))
    return None


def all_rows(table, params, page=1000):
    """Вся таблица постранично. ⚠️ PostgREST отдаёт не больше `db-max-rows`
    (у нас 1000): без страниц выборка МОЛЧА обрезается, и по обрезку потом
    считают итоги."""
    rows, offset = [], 0
    while True:
        got = sb(table, params=dict(params, limit=page, offset=offset))
        if got is None:
            raise SystemExit("не смогли прочитать %s — итоги по обрезку врали бы" % table)
        rows.extend(got)
        if len(got) < page:
            return rows
        offset += page
