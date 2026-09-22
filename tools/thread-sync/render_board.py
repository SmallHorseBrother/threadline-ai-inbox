"""Render a merged Codex task snapshot as a self-contained offline dashboard."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
from typing import Any


STATUS_LABELS = {
    "needs_attention": "等我处理",
    "in_progress": "进行中",
    "active": "收件箱",
    "suggested_next": "建议继续",
    "completed": "已完成",
    "archived": "已归档",
    "blocked": "已阻塞",
}


def render_dashboard(board: dict[str, Any]) -> str:
    tasks = board.get("tasks")
    if not isinstance(tasks, list):
        raise ValueError("board JSON must contain a tasks array")
    safe_payload = json.dumps(board, ensure_ascii=False, separators=(",", ":"))
    safe_payload = safe_payload.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")
    labels = json.dumps(STATUS_LABELS, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Threadline 本地任务板</title><style>
:root{{--ink:#1d1c21;--muted:#77727f;--paper:#f4f1eb;--card:#fffdf9;--violet:#7356da;--line:#ddd7cc}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 system-ui,"Microsoft YaHei",sans-serif}}
header{{position:sticky;top:0;z-index:2;padding:18px 24px;background:#242229;color:white;display:flex;gap:20px;align-items:center;flex-wrap:wrap}}
h1{{font-size:20px;margin:0}}header p{{margin:0;color:#c9c3d1}}input,select{{padding:10px 13px;border:1px solid #595460;border-radius:10px;background:#302d35;color:white}}input{{margin-left:auto;min-width:260px}}select{{min-width:110px}}
.stats{{display:flex;gap:8px;padding:18px 24px 0;flex-wrap:wrap}}.stat{{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:7px 11px}}
main{{display:grid;grid-template-columns:repeat(6,minmax(250px,1fr));gap:14px;padding:18px 24px 30px;overflow:auto;align-items:start}}
section{{min-height:180px}}h2{{font-size:13px;margin:0 0 10px;display:flex;justify-content:space-between}}.count{{color:var(--muted)}}
.card{{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--violet);border-radius:12px;padding:12px;margin-bottom:9px;box-shadow:0 3px 12px #352f4210}}
.card strong{{display:block;font-size:14px;margin-bottom:8px;word-break:break-word}}.meta{{color:var(--muted);font-size:12px;display:flex;gap:7px;flex-wrap:wrap}}.account{{padding:2px 7px;border-radius:999px;background:#eee8ff;color:#5943a6;font-weight:700}}.action{{margin:9px 0 0;color:#50485f}}
.empty{{border:1px dashed var(--line);border-radius:12px;color:var(--muted);padding:18px;text-align:center}}footer{{padding:0 24px 24px;color:var(--muted);font-size:12px}}
@media(max-width:900px){{main{{grid-template-columns:repeat(2,minmax(260px,1fr))}}input{{margin-left:0;width:100%}}}}@media(max-width:600px){{main{{grid-template-columns:1fr}}}}
</style></head><body><header><div><h1>Threadline · 本地任务板</h1><p id="stamp">跨账号、跨设备合并快照</p></div><input id="search" placeholder="搜索标题、账号或设备" aria-label="搜索任务"><select id="account" aria-label="筛选账号"><option value="">全部账号</option></select></header>
<div class="stats" id="stats"></div><main id="board"></main><footer>离线文件 · 不连接网络 · 只包含同步快照中的元数据</footer>
<script type="application/json" id="payload">{safe_payload}</script><script>
const data=JSON.parse(document.getElementById('payload').textContent);const labels={labels};
const order=['needs_attention','in_progress','active','suggested_next','completed','archived'];
const root=document.getElementById('board'),stats=document.getElementById('stats'),search=document.getElementById('search'),account=document.getElementById('account');
const accountNames=[...new Set((data.tasks||[]).map(t=>t.account_alias||'账号1'))].sort();for(const name of accountNames){{const option=el('option','',name);option.value=name;account.append(option)}}
document.getElementById('stamp').textContent='更新于 '+(data.generated_at||'未知时间')+' · '+accountNames.length+' 个账号 · '+(data.sources?.length||data.devices?.length||data.device_count||1)+' 台设备';
function el(tag,cls,text){{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}}
function render(){{const q=search.value.trim().toLowerCase(),selectedAccount=account.value;const tasks=(data.tasks||[]).filter(t=>(!selectedAccount||(t.account_alias||'账号1')===selectedAccount)&&(!q||[t.title,t.account_alias||'账号1',...(t.device_ids||[])].join(' ').toLowerCase().includes(q)));root.replaceChildren();stats.replaceChildren();
stats.append(el('span','stat','共 '+tasks.length+' 项'),el('span','stat',accountNames.length+' 个账号'));for(const s of order){{const n=tasks.filter(t=>t.status===s).length;if(n)stats.append(el('span','stat',(labels[s]||s)+' '+n));const sec=el('section');const h=el('h2');h.append(el('span','',labels[s]||s),el('span','count',String(n)));sec.append(h);const items=tasks.filter(t=>t.status===s).sort((a,b)=>(b.attention_score||0)-(a.attention_score||0));if(!items.length)sec.append(el('div','empty','暂无任务'));for(const t of items){{const card=el('article','card');card.append(el('strong','',t.title||'未命名对话'));const meta=el('div','meta');meta.append(el('span','account',t.account_alias||'账号1'),el('span','',(t.attention_score??0)+' 分'),el('span','',(t.device_ids||[]).join(' · ')||'未知设备'));card.append(meta,el('p','action',actionText(t.recommended_action)));sec.append(card)}}root.append(sec)}}}}
function actionText(v){{return ({{unblock_goal:'解除阻塞并补充信息',review_required_input:'完成待确认事项',continue_goal:'继续当前目标',continue_thread:'回到对话继续推进',review_stale_thread:'回看进展并决定下一步',review_archive_if_needed:'确认归档任务是否完成',review_or_continue:'查看最近进展',none:'无需下一步'}})[v]||'查看原对话')}}
search.addEventListener('input',render);account.addEventListener('change',render);render();</script></body></html>"""


def write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
        os.replace(temporary, path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Merged board.json")
    parser.add_argument("--output", type=Path, default=Path("board.html"))
    args = parser.parse_args()
    board = json.loads(args.input.read_text(encoding="utf-8"))
    write_atomic(args.output.resolve(), render_dashboard(board))
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
