#!/usr/bin/env python3

import base64, sys

with open('public/favicon.ico', 'rb') as f:
    b64 = base64.b64encode(f.read()).decode()

with open('public/b64favicon', 'w') as f:
    f.write('<link rel=\"icon\" href=\"data:image/x-icon;base64,' + b64 + '\">')
