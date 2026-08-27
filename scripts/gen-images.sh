#!/bin/bash
# Parallel image generation via z-ai CLI
OUT=/home/z/my-project/public/images
mkdir -p "$OUT"
JOBS=/tmp/imgjobs.tsv
> "$JOBS"

add() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$JOBS"; }

STYLE="professional pharmacy product photography, clean white background with soft mint green accents, studio lighting, high quality, detailed"

add hero.png 1440x720 "Bright modern pharmacy interior, friendly pharmacist in white coat with green accent handing a paper bag of medicines over the counter, shelves of medicine boxes, soft natural light, welcoming atmosphere, professional photography, high quality, detailed"
add cat-pain-relief.png 1152x864 "Blister packs of pain relief tablets and a white topical gel tube arranged neatly, $STYLE"
add cat-antibiotics.png 1152x864 "Antibiotic capsules in blister packs and amber pill bottles, $STYLE"
add cat-vitamins-supplements.png 1152x864 "Vitamin supplement bottles with orange slices and green leaves, fresh healthy mood, $STYLE"
add cat-cold-flu.png 1152x864 "Cough syrup bottle with honey, lemon and warm cup of tea, cozy cold and flu remedy scene, $STYLE"
add cat-diabetes-care.png 1152x864 "Digital blood glucose meter with test strips and lancets, $STYLE"
add cat-skin-care.png 1152x864 "Dermatology cream tubes and skincare jars with soft towel, $STYLE"
add cat-heart-bp.png 1152x864 "Digital blood pressure monitor with arm cuff and stethoscope, $STYLE"
add cat-first-aid.png 1152x864 "First aid kit box with bandages, gauze roll and antiseptic bottle, $STYLE"

add med-napa.png 1024x1024 "strip of paracetamol plus caffeine tablets in blister pack, $STYLE"
add med-ace.png 1024x1024 "blister pack of plain white round paracetamol tablets, $STYLE"
add med-flamerin.png 1024x1024 "white topical pain relief gel tube 30g, $STYLE"
add med-seclo.png 1024x1024 "omeprazole capsule blister pack, $STYLE"
add med-azyth.png 1024x1024 "azithromycin 500 tablet blister pack, $STYLE"
add med-cef3.png 1024x1024 "cefixime capsule strip in green box, $STYLE"
add med-amoxin.png 1024x1024 "amoxicillin capsule strip red and white, $STYLE"
add med-savoy.png 1024x1024 "small round ointment tin with lid open, $STYLE"
add med-fexo.png 1024x1024 "allergy relief fexofenadine tablet blister, $STYLE"
add med-torex.png 1024x1024 "amber glass cough syrup bottle with carton box, $STYLE"
add med-maxpro-d3.png 1024x1024 "vitamin D3 softgel capsule white bottle, $STYLE"
add med-neurob.png 1024x1024 "vitamin B complex tablet strip gold accents, $STYLE"
add med-zinconia.png 1024x1024 "zinc supplement tablet strip purple accents, $STYLE"
add med-sodibicarb.png 1024x1024 "small antacid powder box with sachet, $STYLE"
add med-glucometer.png 1024x1024 "digital glucose meter kit with carry case, $STYLE"
add med-glucophage.png 1024x1024 "metformin tablet blister pack teal accents, $STYLE"
add med-strips.png 1024x1024 "glucose test strips box of 50, $STYLE"
add med-cetaphil.png 1024x1024 "gentle skin cleanser pump bottle 125ml, $STYLE"
add med-fungin.png 1024x1024 "antifungal clotrimazole cream tube, $STYLE"
add med-amodis.png 1024x1024 "corticosteroid dermatitis cream tube 25g, $STYLE"
add med-bisocor.png 1024x1024 "bisoprolol blood pressure tablet blister, $STYLE"
add med-ecosprin.png 1024x1024 "low dose aspirin 75 tablet blister, $STYLE"
add med-bpmonitor.png 1024x1024 "digital upper arm blood pressure monitor, $STYLE"
add med-savlon.png 1024x1024 "antiseptic liquid bottle green label, $STYLE"
add med-bandage.png 1024x1024 "rolled elastic crepe bandage 4 inch, $STYLE"
add med-thermometer.png 1024x1024 "digital clinical thermometer, $STYLE"

gen_one() {
  local file="$1" size="$2" prompt="$3"
  for i in 1 2 3; do
    if z-ai image -p "$prompt" -o "$OUT/$file" -s "$size" >/dev/null 2>&1 && [ -s "$OUT/$file" ]; then
      echo "OK $file"
      return 0
    fi
    sleep 2
  done
  echo "FAIL $file"
}
export -f gen_one
export OUT

# 6 concurrent workers
cut -f1-3 "$JOBS" | xargs -P 6 -d '\n' -I{} bash -c 'IFS=$'"'"'\t'"'"' read -r f s p <<< "{}"; gen_one "$f" "$s" "$p"'
echo "ALL DONE: $(ls "$OUT" | wc -l) images"
