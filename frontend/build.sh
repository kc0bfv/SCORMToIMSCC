#!/bin/bash

npm run build

INDEXJSARR=(dist/assets/index-*.js)
INDEXJS=${INDEXJSARR[0]}
echo $INDEXJS

echo '<script>' > jszip.js
cat "./src/lib/jszip.min.js" >> jszip.js
echo '</script>' >> jszip.js

echo '<script type="module">' > indexjsrep.js
cat "$INDEXJS" >> indexjsrep.js
echo '</script>' >> indexjsrep.js

mv dist/index.html dist/index.html.bak
sed '/script type="module" crossorigin src="\/assets\/index-/{
  r jszip.js
}' dist/index.html.bak > index_i.html
sed '/script type="module" crossorigin src="\/assets\/index-/{
  r indexjsrep.js
  d
}' index_i.html > dist/index.html

rm indexjsrep.js jszip.js index_i.html
