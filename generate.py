#!/usr/bin/env python3
"""
tools.json を唯一の正解データ（Single Source of Truth）として、
index.html のツール一覧部分と sitemap.xml を自動生成するスクリプト。

■ 使い方
    python3 generate.py
    ※ 通常は手で実行しなくてOK。tools.json か index.template.html を
      main に push すると、GitHub Actions（generate.yml）が自動で実行する

■ ファイル構成（すべてリポジトリ直下のフラット構成）
    tools.json            … ツール一覧の正解データ（これだけ手で編集する）
    index.template.html   … トップページ本体。TOOLLIST_START〜ENDの間だけ自動置換される
                            ★トップの見た目を変えたい時はここを編集する
    index.html            … 自動生成される完成品（★直接編集しない。編集しても次回の生成で上書きされる）
    sitemap.xml           … 自動生成される完成品（★直接編集しない）

■ 新しいツールを追加するとき
    1. 直下に <id>.html を作る
    2. tools.json に1件追記する
       （id / name / url / file / emoji / category / desc を埋める）
       ・urlは絶対URL（https://arigato-tools.com/<id>）。sitemap.xmlにそのまま出力される
       ・前の行の末尾のカンマを忘れない（JSON構文エラーになると生成が止まる）
    3. 同じコミットで main に push する
       → Actionsが index.html と sitemap.xml を自動更新する

■ 本番ドメイン
    arigato-tools.com 固定（sitemap.xml・canonicalタグ共通）
"""

import json
from pathlib import Path
from xml.sax.saxutils import escape

BASE_DIR = Path(__file__).resolve().parent
TOOLS_JSON = BASE_DIR / "tools.json"
INDEX_TEMPLATE = BASE_DIR / "index.template.html"
DIST_DIR = BASE_DIR

DOMAIN = "https://arigato-tools.com"

TOOLLIST_START = "<!-- TOOLLIST_START -->"
TOOLLIST_END = "<!-- TOOLLIST_END -->"


def load_tools():
    with open(TOOLS_JSON, encoding="utf-8") as f:
        return json.load(f)


def build_tool_list_html(tools) -> str:
    """tools.json の並び順どおりに <li> ブロックを組み立てる"""
    items = []
    for t in tools:
        items.append(
            "  <li>\n"
            f'    <a href="{escape(t["file"])}">{escape(t["name"])}</a>\n'
            f'    <div class="desc">{escape(t["desc"])}</div>\n'
            "  </li>"
        )
    return "\n".join(items)


def build_index_html(tools) -> str:
    if not INDEX_TEMPLATE.exists():
        raise FileNotFoundError(f"テンプレが見つかりません: {INDEX_TEMPLATE}")

    template_html = INDEX_TEMPLATE.read_text(encoding="utf-8")

    if TOOLLIST_START not in template_html or TOOLLIST_END not in template_html:
        raise ValueError("index.template.html に TOOLLIST_START / TOOLLIST_END の目印がありません")

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
    index_path = DIST_DIR / "index.html"
    index_path.write_text(index_html, encoding="utf-8")
    print(f"✓ 生成しました: {index_path}  ({len(tools)}件のツールを掲載)")

    sitemap_xml = build_sitemap_xml(tools)
    sitemap_path = DIST_DIR / "sitemap.xml"
    sitemap_path.write_text(sitemap_xml, encoding="utf-8")
    print(f"✓ 生成しました: {sitemap_path}  ({len(tools) + 1}件のURL)")


if __name__ == "__main__":
    main()
