# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置

用法：
    pip install pyinstaller
    pyinstaller build/mythclass.spec

产物在 dist/Mythclass.exe，单文件，无控制台窗口。
"""

block_cipher = None

a = Analysis(
    ['../mythclass/__main__.py'],
    pathex=['..'],
    binaries=[],
    datas=[
        ('../config.example.json', '.'),
    ],
    hiddenimports=[
        'pystray._win32',
        'PIL._tkinter_finder',
        'watchdog.observers.winapi',
        'win32timezone',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'numpy', 'pandas', 'PyQt5', 'PySide2'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='Mythclass',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # 无界面，别弹黑框
    disable_windowed_traceback=True,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,              # 想换图标就放个 .ico 路径在这儿
)
