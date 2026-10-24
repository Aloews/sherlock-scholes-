from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
BANKROLL = MIGRATIONS / "20261017183115_llm_paper_bankroll.sql"
EXPRESSES = MIGRATIONS / "20261017183122_forecast_diverse_accumulators.sql"


def test_paper_bankroll_migration_has_balanced_function_bodies():
    sql = BANKROLL.read_text(encoding="utf-8")
    assert sql.count("as $$") == sql.count("$$;")
    assert not re.search(r"^\s*as \$\s*$", sql, flags=re.MULTILINE)
    assert not re.search(r"^\s*\$;\s*$", sql, flags=re.MULTILINE)


def test_removed_forecast_model_is_cleaned_up_by_dedicated_migration():
    cleanup = MIGRATIONS / "20261023110000_remove_retired_forecast_model.sql"
    sql = cleanup.read_text(encoding="utf-8").lower()
    assert "delete from public.forecast_pick where model = 'fly'" in sql
    assert "delete from public.forecast_calibration where model = 'fly'" in sql
    assert "drop table if exists public.fly_state" in sql
    assert "drop column if exists dopamine_at" in sql
    assert "check (model in ('llm', 'own'))" in sql
    assert "delete from public.accumulator_ticket where model = 'fly'" in sql
    assert "array['llm', 'own']" in sql


def test_paper_bankroll_tables_are_not_publicly_writable():
    sql = BANKROLL.read_text(encoding="utf-8").lower()
    for table in ("llm_paper_bankroll", "llm_paper_ledger", "llm_paper_policy"):
        assert f"revoke all on public.{table} from public, anon, authenticated" in sql
    assert "grant execute on function public.settle_llm_paper_bankroll() to service_role" in sql
    assert "grant execute on function public.train_llm_paper_policy() to service_role" in sql


def test_diverse_accumulator_rpc_checks_admin_password():
    sql = EXPRESSES.read_text(encoding="utf-8").lower()
    assert "security definer" in sql
    assert "public.admin_check_password(p_password)" in sql
    assert "revoke all on function public.admin_diverse_accumulators(text, integer) from public" in sql


def test_duel_model_labels_match_implementation_and_retired_connectome_names_are_absent():
    import json

    labels = {
        "ar": ("نموذج خطي", "خطي"),
        "en": ("Linear model", "Linear"),
        "es": ("Modelo lineal", "Lineal"),
        "fr": ("Modèle linéaire", "Linéaire"),
        "ja": ("線形モデル", "線形"),
        "ko": ("선형 모델", "선형"),
        "pt": ("Modelo linear", "Linear"),
        "ru": ("Линейная модель", "Линейная"),
        "zh": ("线性模型", "线性"),
    }
    retired_names = re.compile(
        "|".join((
            "".join(("hemi", "brain")),
            "".join(("connect", "ome")),
            "".join(("conect", "om")),
            "".join(("коннек", "том")),
            "".join(("コネクト", "ーム")),
            "".join(("커넥", "톰")),
            "".join(("连接", "组")),
        )),
        re.IGNORECASE,
    )
    locales = ROOT / "src" / "shared" / "i18n" / "locales"
    for lang, (model_label, short_label) in labels.items():
        raw = (locales / f"{lang}.json").read_text(encoding="utf-8")
        assert not retired_names.search(raw), f"retired model name remains in {lang}"
        data = json.loads(raw)

        def find_duel(node):
            if isinstance(node, dict):
                model = node.get("model")
                short = node.get("short")
                if (
                    isinstance(model, dict)
                    and isinstance(short, dict)
                    and all(k in model for k in ("own", "llm", "fly", "median", "current"))
                    and all(k in short for k in ("own", "llm", "fly"))
                ):
                    return model, short
                for value in node.values():
                    found = find_duel(value)
                    if found:
                        return found
            elif isinstance(node, list):
                for value in node:
                    found = find_duel(value)
                    if found:
                        return found
            return None

        duel = find_duel(data)
        assert duel is not None, f"duel model labels missing in {lang}"
        assert duel[0]["llm"] == model_label, f"wrong linear model label in {lang}"
        assert duel[1]["llm"] == short_label, f"wrong short linear label in {lang}"
