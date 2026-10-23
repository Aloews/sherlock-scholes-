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
    cleanup = MIGRATIONS / "20261023110000_remove_connectome_forecast_model.sql"
    sql = cleanup.read_text(encoding="utf-8").lower()
    assert "delete from public.forecast_pick where model = 'fly'" in sql
    assert "delete from public.forecast_calibration where model = 'fly'" in sql
    assert "drop table if exists public.fly_state" in sql
    assert "drop column if exists dopamine_at" in sql
    assert "check (model in ('llm', 'own'))" in sql


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
