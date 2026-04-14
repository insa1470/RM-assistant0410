#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
舊版 RM 隨行助手報告遷移工具
支援格式：
  【客户】xxx
  【负责人】xxx
  【时间】2026/04/13 10:00 - 12:00
  【摘要】...
  【待办】...

使用方式：
  python3 migrate.py

支援 .txt 與 .docx 檔案，執行後輸入路徑與上傳者姓名即可。
"""

import re
import json
import uuid
import os
import sys
import zipfile
import urllib.request
from xml.etree import ElementTree as ET

WORKER_URL = 'https://rm-api.deepmystic.net'

# ── 讀取檔案（支援 .txt 與 .docx）────────────────────

def read_file(fpath):
    if fpath.lower().endswith('.docx'):
        return read_docx(fpath)
    # .txt：先試 utf-8，再試 gbk
    for enc in ('utf-8', 'gbk', 'big5'):
        try:
            with open(fpath, 'r', encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, LookupError):
            continue
    raise ValueError(f'無法讀取檔案編碼：{fpath}')

def read_docx(fpath):
    """不需要第三方套件，直接從 docx 的 XML 中抽取純文字"""
    ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    lines = []
    with zipfile.ZipFile(fpath, 'r') as z:
        with z.open('word/document.xml') as f:
            tree = ET.parse(f)
    for para in tree.iter(f'{ns}p'):
        parts = []
        for t in para.iter(f'{ns}t'):
            if t.text:
                parts.append(t.text)
        lines.append(''.join(parts))
    return '\n'.join(lines)

# ── 解析報告文字 ──────────────────────────────────────

def parse_report(text):
    r = {
        'type': 'report',
        'client_name': None,
        'owner': None,
        'visit_date': None,
        'visit_hour': None,
        'visit_end_hour': None,
        'purpose': '客户拜访',
        'city': None,
        'is_8_plus_e': False,
        'follow_up': None,
        'tmpl': {},
        'todo_list': [],
    }

    # 客户
    m = re.search(r'【客[户戶]】(.+)', text)
    if m:
        r['client_name'] = m.group(1).strip()

    # 负责人（對方聯絡人）
    m = re.search(r'【负责人】(.+)', text)
    if m:
        r['owner'] = m.group(1).strip()

    # 时间：2026/04/13 10:00 - 12:00
    m = re.search(
        r'【时间】(\d{4}[/\-]\d{1,2}[/\-]\d{1,2})'
        r'(?:\s+(\d{1,2}):\d{2}\s*[-–~]\s*(\d{1,2}):\d{2})?',
        text
    )
    if m:
        r['visit_date'] = m.group(1).replace('/', '-')
        if m.group(2):
            r['visit_hour']     = int(m.group(2))
            r['visit_end_hour'] = int(m.group(3))

    # 摘要
    m = re.search(r'【摘要】\s*\n([\s\S]+?)(?=\n【|\n-{3,}|$)', text)
    if m:
        r['tmpl']['customerNeed'] = m.group(1).strip()

    # 待办
    m = re.search(r'【待[办辦]】\s*\n([\s\S]+?)(?=\n-{3,}|\n【|$)', text)
    if m:
        block = m.group(1).strip()
        todos = re.findall(r'(?:^|\n)\s*[\d一二三四五六七八九十]+[、.．\s]\s*(.+)', block)
        r['todo_list'] = [t.strip() for t in todos if t.strip()]

    return r

# ── 上傳至 Worker ─────────────────────────────────────

def upload(record, user_name):
    payload = {
        'id':           str(uuid.uuid4()),
        'userName':     user_name,
        'type':         record['type'],
        'clientName':   record['client_name'],
        'owner':        record.get('owner'),
        'visitDate':    record['visit_date'],
        'visitHour':    record['visit_hour'],
        'visitEndHour': record['visit_end_hour'],
        'purpose':      record['purpose'],
        'city':         record.get('city'),
        'is8PlusE':     record['is_8_plus_e'],
        'followUp':     record.get('follow_up'),
        'tmpl':         record['tmpl'],
    }
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req  = urllib.request.Request(
        f'{WORKER_URL}/api/record',
        data=data,
        headers={
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0',
        },
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())

# ── 主流程 ────────────────────────────────────────────

def main():
    print('=' * 50)
    print('  RM 隨行助手 — 舊版報告遷移工具')
    print('=' * 50)

    # 資料夾路徑
    folder = input('\n請輸入報告資料夾路徑（可直接拖曳資料夾）：').strip().strip("'\"")
    if not os.path.isdir(folder):
        print(f'❌ 找不到資料夾：{folder}')
        sys.exit(1)

    # 掃描 .txt 與 .docx 檔
    files = sorted([f for f in os.listdir(folder)
                    if f.lower().endswith('.txt') or f.lower().endswith('.docx')])
    if not files:
        print('❌ 資料夾內沒有 .txt 或 .docx 檔案')
        sys.exit(1)

    print(f'\n找到 {len(files)} 個 .txt 檔案：')
    for f in files:
        print(f'  • {f}')

    # 上傳者姓名
    print()
    user_name = input('請輸入上傳者姓名（例如：周小明）：').strip()
    if not user_name:
        print('❌ 姓名不能為空')
        sys.exit(1)

    # 可選：統一設定 RM 組別
    rm_group = input('RM 組別（可留空）：').strip() or None

    # 確認
    print(f'\n即將以「{user_name}」身份上傳 {len(files)} 筆，確認嗎？(y/n) ', end='')
    if input().strip().lower() != 'y':
        print('已取消')
        sys.exit(0)

    print()
    success = 0
    skipped = 0
    failed  = 0

    for fname in files:
        fpath = os.path.join(folder, fname)
        try:
            text = read_file(fpath)
        except Exception as e:
            print(f'❌ {fname}：讀取失敗 — {e}')
            failed += 1
            continue

        record = parse_report(text)

        if rm_group:
            record['rm_group'] = rm_group

        if not record['client_name']:
            print(f'⚠️  {fname}：找不到【客户】欄位，跳過')
            skipped += 1
            continue

        if not record['visit_date']:
            print(f'⚠️  {fname}：找不到【时间】欄位，跳過')
            skipped += 1
            continue

        try:
            upload(record, user_name)
            print(f'✅ {fname}：{record["client_name"]} ({record["visit_date"]}) 上傳成功')
            success += 1
        except Exception as e:
            print(f'❌ {fname}：上傳失敗 — {e}')
            failed += 1

    print()
    print('=' * 50)
    print(f'  完成：成功 {success} 筆｜跳過 {skipped} 筆｜失敗 {failed} 筆')
    print('=' * 50)

if __name__ == '__main__':
    main()
