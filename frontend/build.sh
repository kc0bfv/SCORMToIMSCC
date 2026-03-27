#!/bin/bash

npm install
npm run build

INDEXJSARR=(dist/assets/index-*.js)
INDEXJS=${INDEXJSARR[0]}
echo $INDEXJS

# --- Inline JSZip and the app bundle into the HTML ---

echo '<script type="module">' > jszip.js
cat "./src/lib/jszip.min.js" >> jszip.js
echo '</script>' >> jszip.js

echo '<script type="module">' > indexjsrep.js
cat "$INDEXJS" >> indexjsrep.js
echo '</script>' >> indexjsrep.js

mv dist/index.html dist/index.html.bak
sed '/script type="module" crossorigin src="\/assets\/index-/{
  r jszip.js
  r indexjsrep.js
  d
}' dist/index.html.bak > dist/index.html.noicon

sed '/link rel=/{
  r public/b64favicon
  d
}' dist/index.html.noicon > dist/index.html


rm indexjsrep.js jszip.js
