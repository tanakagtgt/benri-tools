#!/usr/bin/env python3
"""
テンプレHTML + 解説フラグメントを合成して、本番アップロード用のHTMLを
/dist に書き出すビルドスクリプト。

■ 使い方
    python3 build.py                 # src/templates 配下を全部ビルド
    python3 build.py eigyobi-count   # 特定ツールだけビルド

■ 前提のファイル構成
    src/templates/<tool>.template.html   … 本体（<!-- DESC_START --> 〜 <!-- DESC_END --> の間は自動置換）
    src/desc/<tool>.desc.html            … 解説文フラグメント（自由に書いてOK）
    dist/<tool>.html                     … 生成される完成品（これを本番にアップロード）

■ 新規ツールを追加するとき
    1. src/templates/ に <tool>.template.html を置く
       （<!-- DESC_START --> と <!-- DESC_END --> の2行を解説文を入れたい場所に書いておく）
    2. src/desc/ に <tool>.desc.html を置く
    3. python3 build.py <tool> を実行
"""

import re
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = BASE_DIR / "src" / "templates"
DESC_DIR = BASE_DIR / "src" / "desc"
DIST_DIR = BASE_DIR / "dist"

DESC_START = "<!-- DESC_START -->"
DESC_END = "<!-- DESC_END -->"


def build_one(tool_name: str) -> None:
    template_path = TEMPLATE_DIR / f"{tool_name}.template.html"
    desc_path = DESC_DIR / f"{tool_name}.desc.html"
    dist_path = DIST_DIR / f"{tool_name}.html"

    if not template_path.exists():
        print(f"✗ テンプレが見つかりません: {template_path}")
        return
    if not desc_path.exists():
        print(f"✗ 解説文が見つかりません: {desc_path}")
        return

    template_html = template_path.read_text(encoding="utf-8")
    desc_html = desc_path.read_text(encoding="utf-8")

    if DESC_START not in template_html or DESC_END not in template_html:
        print(f"✗ {template_path.name} に DESC_START / DESC_END の目印がありません")
        return

    # DESC_START〜DESC_END の間をまるごと解説文で置き換える
    pattern = re.compile(
        re.escape(DESC_START) + r".*?" + re.escape(DESC_END),
        re.DOTALL,
    )
    replacement = f"{DESC_START}\n{desc_html.strip()}\n{DESC_END}"
    built_html, count = pattern.subn(replacement, template_html)

    if count == 0:
        print(f"✗ 置換に失敗しました: {template_path.name}")
        return

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    dist_path.write_text(built_html, encoding="utf-8")
    print(f"✓ 生成しました: {dist_path}  ({len(built_html):,} 文字)")


def main() -> None:
    args = sys.argv[1:]

    if args:
        for tool_name in args:
            build_one(tool_name)
        return

    if not TEMPLATE_DIR.exists():
        print(f"✗ テンプレディレクトリがありません: {TEMPLATE_DIR}")
        return

    template_files = sorted(TEMPLATE_DIR.glob("*.template.html"))
    if not template_files:
        print("✗ ビルド対象のテンプレが見つかりませんでした")
        return

    for template_path in template_files:
        tool_name = template_path.name.removesuffix(".template.html")
        build_one(tool_name)


if __name__ == "__main__":
    main()
