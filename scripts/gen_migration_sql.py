import json

def esc(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"

def gen_insert(table, rows, bool_cols=None, cast_ints=None):
    bool_cols = bool_cols or []
    if not rows:
        return f"-- no rows for {table}\n"
    cols = list(rows[0].keys())
    lines = [f"INSERT INTO {table} ({', '.join(cols)}) VALUES"]
    value_rows = []
    for r in rows:
        vals = []
        for c in cols:
            v = r[c]
            if c in bool_cols:
                v = bool(v) if v is not None else None
            vals.append(esc(v))
        value_rows.append(f"({', '.join(vals)})")
    lines.append(",\n".join(value_rows) + ";")
    lines.append(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 1));")
    return "\n".join(lines) + "\n\n"

out = []
tables = [
    ("companies", {}),
    ("theses", {}),
    ("thesis_assumptions", {}),
    ("thesis_companies", {}),
    ("sources", {}),
    ("signals", {"bool_cols": ["priced_in_flag"]}),
    ("signal_scores", {}),
    ("research_inbox_items", {}),
    ("watchlist_items", {}),
    ("audit_log", {}),
    ("settings", {}),
    ("edgar_ticker_cik_cache", {}),
]

for table, opts in tables:
    with open(f"/tmp/{table}.json") as f:
        rows = json.load(f)
    out.append(gen_insert(table, rows, bool_cols=opts.get("bool_cols")))

with open("/tmp/migration_data.sql", "w") as f:
    f.write("".join(out))

print("done, size:", sum(len(x) for x in out))
