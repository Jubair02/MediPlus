#!/bin/bash
OUT=/home/z/my-project/public/images
STYLE="professional pharmacy product photography, clean white background with soft mint green accents, studio lighting, high quality, detailed"
gen() { # file size prompt
  local f="$1" s="$2" p="$3"
  [ -s "$OUT/$f" ] && { echo "SKIP $f"; return 0; }
  for i in 1 2 3 4 5; do
    if z-ai image -p "$p" -o "$OUT/$f" -s "$s" >/dev/null 2>&1 && [ -s "$OUT/$f" ]; then echo "OK $f"; return 0; fi
    echo "retry$i $f failed, waiting..."; sleep 20
  done
  echo "GIVEUP $f"
}
gen hero.png 1440x720 "Bright modern pharmacy interior, friendly pharmacist in white coat with green accent handing a paper bag of medicines over the counter, shelves of medicine boxes, soft natural light, welcoming atmosphere, professional photography, high quality, detailed"
for spec in \
  "med-neurob.png|vitamin B complex tablet strip gold accents" \
  "med-zinconia.png|zinc supplement tablet strip purple accents" \
  "med-sodibicarb.png|small antacid powder box with sachet" \
  "med-glucometer.png|digital glucose meter kit with carry case" \
  "med-glucophage.png|metformin tablet blister pack teal accents" \
  "med-strips.png|glucose test strips box of 50" \
  "med-cetaphil.png|gentle skin cleanser pump bottle 125ml" \
  "med-fungin.png|antifungal clotrimazole cream tube" \
  "med-amodis.png|corticosteroid dermatitis cream tube 25g" \
  "med-bisocor.png|bisoprolol blood pressure tablet blister" \
  "med-ecosprin.png|low dose aspirin 75 tablet blister" \
  "med-bpmonitor.png|digital upper arm blood pressure monitor" \
  "med-savlon.png|antiseptic liquid bottle green label" \
  "med-bandage.png|rolled elastic crepe bandage 4 inch" \
  "med-thermometer.png|digital clinical thermometer"; do
  IFS='|' read -r f d <<< "$spec"
  gen "$f" 1024x1024 "$d, $STYLE"
  sleep 4
done
echo "ALL DONE: $(ls $OUT | wc -l)"
