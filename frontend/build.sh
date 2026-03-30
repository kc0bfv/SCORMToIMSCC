#!/bin/bash
set -e

npm install
npm run build

INDEXJSARR=(dist/assets/index-*.js)
INDEXJS=${INDEXJSARR[0]}
echo $INDEXJS

INDEXCSSARR=(dist/assets/index-*.css)
INDEXCSS=${INDEXCSSARR[0]}
echo $INDEXCSS

# --- Inline JSZip and the app bundle into the HTML ---

echo '<script type="module">' > jszip.js
cat "./src/lib/jszip.min.js" >> jszip.js
echo '</script>' >> jszip.js

echo '<script type="module">' > indexjsrep.js
cat "$INDEXJS" >> indexjsrep.js
echo '</script>' >> indexjsrep.js

echo '<style>' > indexcssrep.css
cat "$INDEXCSS" >> indexcssrep.css
echo '</style>' >> indexcssrep.css


mv dist/index.html dist/index.html.bak
sed '/script type="module" crossorigin src="\/assets\/index-/{
  r jszip.js
  r indexjsrep.js
  d
}' dist/index.html.bak > dist/index.html.noicon

sed '/favicon.ico/{
  r public/b64favicon
  d
}' dist/index.html.noicon > dist/index.html.nostyle

sed '/stylesheet/{
  r indexcssrep.css
  d
}' dist/index.html.nostyle > dist/index.html

mkdir -p build_output
cp dist/index.html build_output/

rm indexcssrep.css indexjsrep.js jszip.js
