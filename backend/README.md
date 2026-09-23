# PREVAIL Backend (Prem)

Observability API — proxies Rust runtime. **Does not** hold authority.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export PREVAIL_RUNTIME_URL=http://127.0.0.1:8090
python -m prevail_backend.main
```

API: `http://127.0.0.1:8000` · Docs: `/docs`
