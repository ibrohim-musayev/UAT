#!/usr/bin/env bash
# Облегчённые модели для телефонов (*.mobile.glb): меньше треугольников, текстуры-палитры 256 px.
# Запуск из корня проекта после обновления исходных GLB в public/models.
set -euo pipefail
GT="npx -y @gltf-transform/cli@4"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# самолёт: отклонение формы < 0.1% габарита
$GT simplify public/models/A320_UAT.glb "$TMP/a.glb" --ratio 0.3 --error 0.0008
$GT meshopt "$TMP/a.glb" public/models/A320_UAT.mobile.glb

# техники: на экране телефона фигура не выше ~150 px
for f in public/models/tech/TECH_*.glb public/models/tech/ENG_*.glb; do
  case "$f" in *.mobile.glb) continue ;; esac
  n=$(basename "$f" .glb)
  $GT resize "$f" "$TMP/r.glb" --width 256 --height 256
  $GT simplify "$TMP/r.glb" "$TMP/s.glb" --ratio 0.45 --error 0.002
  $GT meshopt "$TMP/s.glb" "public/models/tech/$n.mobile.glb"
done

# реквизит: только текстуры (палитра 4×4 цвета — уменьшение без потерь)
for f in public/models/tech/PROP_*.glb; do
  case "$f" in *.mobile.glb) continue ;; esac
  n=$(basename "$f" .glb)
  $GT resize "$f" "$TMP/r.glb" --width 256 --height 256
  $GT meshopt "$TMP/r.glb" "public/models/tech/$n.mobile.glb"
done
