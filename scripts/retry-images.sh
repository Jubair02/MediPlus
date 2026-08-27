#!/bin/bash
OUT=/home/z/my-project/public/images
STYLE="professional pharmacy product photography, clean white background with soft mint green accents, studio lighting, high quality, detailed"
declare -A P=(
[hero.png]="Bright modern pharmacy interior, friendly pharmacist in white coat with green accent handing a paper bag of medicines over the counter, shelves of medicine boxes, soft natural light, welcoming atmosphere, professional photography, high quality, detailed|1440x720"
[med-neurob.png]="vitamin B complex tablet strip gold accents|$STYLE"
[med-zinconia.png]="zinc supplement tablet strip purple accents|$STYLE"
[med-sodibicarb.png]="small antacid powder box with sachet|$STYLE"
[med-glucometer.png]="digital glucose meter kit with carry case|$STYLE"
[med-glucophage.png]="metformin tablet blister pack teal accents|$STYLE"
[med-strips.png]="glucose test strips box of 50|$STYLE"
[med-cetaphil.png]="gentle skin cleanser pump bottle 125ml|$STYLE"
[med-fungin.png]="antifungal clotrimazole cream tube|$STYLE"
[med-amodis.png]="corticosteroid dermatitis cream tube 25g|$STYLE"
[med-bisocor.png]="bisoprolol blood pressure tablet blister|$STYLE"
[med-ecosprin.png]="low dose aspirin 75 tablet blister|$STYLE"
[med-bpmonitor.png]="digital upper arm blood pressure monitor|$STYLE"
[med-savlon.png]="antiseptic liquid bottle green label|$STYLE"
[med-bandage.png]="rolled elastic crepe bandage 4 inch|$STYLE"
[med-thermometer.png]="digital clinical thermometer|$STYLE"
)
while read -r f; do
  IFS='|' read -r prompt size <<< "${P[$f]}"
  for i in 1 2 3 4; do
    if z-ai image -p "$prompt" -o "$OUT/$f" -s "$size" >/dev/null 2>&1 && [ -s "$OUT/$f" ]; then echo "OK $f"; break; fi
    sleep 5
  done
done < /tmp/retry-list.txt
echo "RETRY DONE: $(ls $OUT | wc -l)"
