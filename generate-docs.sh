#!/bin/bash

echo "# Estructura Actual del Proyecto" > STRUCTURE.md
echo "" >> STRUCTURE.md
echo "\`\`\`" >> STRUCTURE.md
tree -L 3 -I 'node_modules|uploads|outputs' >> STRUCTURE.md
echo "\`\`\`" >> STRUCTURE.md

echo "" >> STRUCTURE.md
echo "## Dependencias Instaladas" >> STRUCTURE.md
echo "\`\`\`json" >> STRUCTURE.md
cat package.json | jq '.dependencies' >> STRUCTURE.md
echo "\`\`\`" >> STRUCTURE.md

echo "Documentación generada en STRUCTURE.md"
