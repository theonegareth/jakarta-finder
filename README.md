# jakarta-finder

Type a description of a place ("near the port", "the old Dutch town hall") and see which Greater Jakarta kecamatan it most likely means, shaded on a map.

It asks OpenRouter's decisions model (jev) two small questions: which city, then which kecamatan inside the likely cities. The result is P(kecamatan) = P(city) × P(kecamatan | city).

## Run

Needs [Bun](https://bun.sh) and an OpenRouter API key.

```sh
bun install
bun build-map.ts                 # downloads GADM 4.1 and writes districts.geojson
export OPENROUTER_API_KEY_CLAUDE_CODE=...   # or set KEY_ENV to the name of another variable
bun run dev
```

## Map data

The boundaries come from [GADM](https://gadm.org) 4.1, level 3. GADM's license allows non-commercial use but not redistribution, so `districts.geojson` is not in this repository: `build-map.ts` builds it locally from the GADM download.
