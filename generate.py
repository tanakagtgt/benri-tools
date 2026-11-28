#!/usr/bin/env python3
"""
tools.json を唯一の正解データ（Single Source of Truth）として、
index.html のツール一覧部分と sitemap.xml を自動生成するスクリプト。

■ 使い方
    python3 generate.py
    ※ 通常は手で実行しなくてOK。tools.json を main に push すると、
      GitHub Actions（generate.yml）が自動で実行する

■ ファイル構成（すべてリポジトリ直下のフラット構成）
    tools.json            … ツール一覧の正解データ（これだけ手で編集する）
    index.html            … トップページ本体（★直接編集してOK）
                            ただしTOOLLIST_START〜ENDの間だけは自動置換されるので触らない
                            （目印コメントを消すと生成が止まる）
    sitemap.xml           … 自動生成される完成品（★直接編集しない）

■ 新しいツールを追加するとき
    1. 直下に <id>.html を作る
    2. tools.json に1件追記する
       （id / name / url / file / emoji / category / desc を埋める）
       ・urlは絶対URL（https://arigato-tools.com/<id>）。sitemap.xmlにそのまま出力される
       ・前の行の末尾のカンマを忘れない（JSON構文エラーになると生成が止まる）
    3. 同じコミットで main に push する
       → Actionsが index.html のツール一覧部分と sitemap.xml を自動更新する

■ 本番ドメイン
    arigato-tools.com 固定（sitemap.xml・canonicalタグ共通）
"""

import json
from pathlib import Path
from xml.sax.saxutils import escape

BASE_DIR = Path(__file__).resolve().parent
TOOLS_JSON = BASE_DIR / "tools.json"
# index.html自体を読み込み、目印の間だけ書き換える（別テンプレは使わない）
INDEX_HTML = BASE_DIR / "index.html"
DIST_DIR = BASE_DIR

DOMAIN = "https://arigato-tools.com"

TOOLLIST_START = "<!-- TOOLLIST_START -->"
TOOLLIST_END = "<!-- TOOLLIST_END -->"


def load_tools():
    with open(TOOLS_JSON, encoding="utf-8") as f:
        return json.load(f)


# トップページ一覧のジャンル分け（表示順＝この並び順）
# カテゴリは tools.json の "category" を見る。和暦（wareki）は
# tools.json 側で "calc"（日常の計算）にしている。
CATEGORIES = [
    ("calc", "🧮 日常の計算"),
    ("fin", "💰 お金の計算"),
    ("conv", "🔄 変換"),
    ("util", "🛠️ 便利ツール"),
    ("doc", "📄 書類・図鑑"),
]


def tool_li(t) -> str:
    # data-yomi：トップページの「名前順（五十音）」並び替えで使う読み仮名
    yomi = escape(t.get("yomi", ""))
    yomi_attr = f' data-yomi="{yomi}"' if yomi else ""
    return (
        f"  <li{yomi_attr}>\n"
        f'    <a href="{escape(t["file"])}">{escape(t["name"])}</a>\n'
        f'    <div class="desc">{escape(t["desc"])}</div>\n'
        "  </li>"
    )


def build_tool_list_html(tools) -> str:
    """ジャンルごとに <section class="tool-group"> のカードを作り、
    tools.json の並び順どおりに <li> を並べる。見出しには件数を入れる。
    トップページのCSS（.tool-groups）が画面幅で1〜4列に並べ、
    JS（検索・並び替え）がカード単位で表示を制御する。"""
    items = []
    known = {cat_id for cat_id, _ in CATEGORIES}
    for cat_id, cat_label in CATEGORIES:
        group = [t for t in tools if t.get("category") == cat_id]
        if not group:
            continue
        items.append(
            f'  <section class="tool-group" data-category="{cat_id}">\n'
            f"    <h2>{cat_label}（{len(group)}件）</h2>\n"
            '    <ul class="tool-list">'
        )
        items.extend(tool_li(t) for t in group)
        items.append("    </ul>\n  </section>")
    # カテゴリ未設定・未知のカテゴリのツールがあれば末尾にそのまま追加（取りこぼし防止）
    rest = [t for t in tools if t.get("category") not in known]
    if rest:
        items.append('  <ul class="tool-list">')
        items.extend(tool_li(t) for t in rest)
        items.append("  </ul>")
    return "\n".join(items)


def build_index_html(tools) -> str:
    if not INDEX_HTML.exists():
        raise FileNotFoundError(f"index.html が見つかりません: {INDEX_HTML}")

    template_html = INDEX_HTML.read_text(encoding="utf-8")

    if TOOLLIST_START not in template_html or TOOLLIST_END not in template_html:
        raise ValueError("index.html に TOOLLIST_START / TOOLLIST_END の目印がありません")

    start_idx = template_html.index(TOOLLIST_START) + len(TOOLLIST_START)
    end_idx = template_html.index(TOOLLIST_END)

    tool_list_html = build_tool_list_html(tools)
    return (
        template_html[:start_idx]
        + "\n"
        + tool_list_html
        + "\n"
        + template_html[end_idx:]
    )


def build_sitemap_xml(tools) -> str:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    lines.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    lines.append(f"  <url><loc>{DOMAIN}/</loc></url>")
    for t in tools:
        lines.append(f"  <url><loc>{escape(t['url'])}</loc></url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def main():
    tools = load_tools()
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    index_html = build_index_html(tools)
    index_path = INDEX_HTML
    index_path.write_text(index_html, encoding="utf-8")
    print(f"✓ 生成しました: {index_path}  ({len(tools)}件のツールを掲載)")

    sitemap_xml = build_sitemap_xml(tools)
    sitemap_path = DIST_DIR / "sitemap.xml"
    sitemap_path.write_text(sitemap_xml, encoding="utf-8")
    print(f"✓ 生成しました: {sitemap_path}  ({len(tools) + 1}件のURL)")


if __name__ == "__main__":
    main()
