#!/usr/bin/env python3
"""Builds the single-file game page:  python3 build.py   ->   index.html
Inlines the stylesheet, the MQTT library and all game scripts so the page needs nothing but a static host."""
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
t = open('src/template.html').read()
css = open('src/style.css').read()
rd = lambda files: "\n".join(open('src/' + f).read() for f in files)
peer = open('src/vendor/mqtt.min.js').read()
js = 'window.LCR_P2P = true;\n' + rd(['mapdata.js', 'engine.js', 'ai.js', 'net_mqtt.js', 'scenery.js', 'map.js', 'ui.js'])
assert '</script' not in js and '</script' not in peer
i = t.index('<div class="shell">')
head, body = t[:i], t[i:]
head = "\n".join(l for l in head.split("\n") if 'claude:viewport-fit-sides' not in l)
icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230e2c46'/%3E%3Cpath d='M6 9h20M6 14h20M6 19h20M6 24h20' stroke-width='3' stroke='%23e0342a'/%3E%3Cpath d='M6 14h20' stroke='%231b9a52' stroke-width='3'/%3E%3Cpath d='M6 19h20' stroke='%23f0a30a' stroke-width='3'/%3E%3Cpath d='M6 24h20' stroke='%232468d8' stroke-width='3'/%3E%3C/svg%3E"
pre = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
       '<meta name="description" content="Lion City Rails: a Ticket to Ride-style train game on a map of Singapore. Play online with friends.">\n'
       f'<link rel="icon" href="{icon}">\n'
       '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>\n')
body = body.replace('<script>\n/*JS*/\n</script>', '<script>\n/*PEER*/\n</script>\n<script>\n/*JS*/\n</script>')
page = pre + head.replace('/*CSS*/', css) + '</head>\n<body>\n' + body.replace('/*PEER*/', peer).replace('/*JS*/', js) + '</body>\n</html>\n'
open('index.html', 'w').write(page)
print('built index.html', len(page) // 1024, 'KB')
